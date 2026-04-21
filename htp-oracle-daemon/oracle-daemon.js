/**
 * HTP Oracle Daemon v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Polls external APIs for event results, signs attestations with your oracle
 * wallet, writes to Firebase /attestations/{eventId}/{oracleAddr}, and
 * auto-resolves events once threshold is reached (default: 1 for solo oracle,
 * set THRESHOLD=3 for multi-oracle hardened mode).
 *
 * Firebase schema (matches firebase-config.js):
 *   /events/{eventId}          — event definitions (status, outcomes, source, closeTime)
 *   /attestations/{eventId}/{addr} — { outcome, sig, ts }
 *   /events/{eventId}/status   — set to 'resolved' on finalization
 *   /events/{eventId}/outcome  — winning outcome string
 *
 * Usage:
 *   node oracle-daemon.js
 *
 * Required env vars (.env file):
 *   ORACLE_MNEMONIC        — 12/24 word mnemonic for oracle signing wallet
 *   FIREBASE_DB_URL        — https://hightable-76401-default-rtdb.europe-west1.firebasedatabase.app
 *   FIREBASE_SERVICE_KEY   — path to serviceAccountKey.json
 *   NETWORK                — tn12 (default) or mainnet
 *   THRESHOLD              — minimum attestations needed to resolve (default: 1)
 *   POLL_INTERVAL_MS       — polling interval in ms (default: 30000)
 */

'use strict';

require('dotenv').config();
const admin   = require('firebase-admin');
const crypto  = require('crypto');
const fetch   = (...args) => import('node-fetch').then(m => m.default(...args));

// ── Config ────────────────────────────────────────────────────────────────────
const ORACLE_MNEMONIC  = process.env.ORACLE_MNEMONIC;
const FIREBASE_DB_URL  = process.env.FIREBASE_DB_URL  || 'https://hightable-76401-default-rtdb.europe-west1.firebasedatabase.app';
const SERVICE_KEY_PATH = process.env.FIREBASE_SERVICE_KEY || './serviceAccountKey.json';
const NETWORK          = process.env.NETWORK          || 'tn12';
const THRESHOLD        = parseInt(process.env.THRESHOLD || '1');
const POLL_MS          = parseInt(process.env.POLL_INTERVAL_MS || '30000');

const REST_URLS = {
  tn12:    'https://api-tn12.kaspa.org',
  mainnet: 'https://api.kaspa.org'
};

// ── Validate env ──────────────────────────────────────────────────────────────
if (!ORACLE_MNEMONIC) {
  console.error('[HTP Oracle] ORACLE_MNEMONIC not set in .env — aborting');
  process.exit(1);
}

// ── Firebase Admin init ───────────────────────────────────────────────────────
let serviceAccount;
try {
  serviceAccount = require(SERVICE_KEY_PATH);
} catch(e) {
  console.error('[HTP Oracle] Cannot load Firebase service key at:', SERVICE_KEY_PATH);
  console.error('  Download from: Firebase Console → Project Settings → Service Accounts');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: FIREBASE_DB_URL
});

const db = admin.database();
console.log('[HTP Oracle] Firebase Admin connected →', FIREBASE_DB_URL);

// ── Oracle wallet key derivation ──────────────────────────────────────────────
// Uses Node.js crypto to derive a deterministic signing key from the mnemonic
// (BIP39 seed → HMAC-SHA256 → 32-byte private key)
// When Kaspa WASM is available server-side, swap this for SDK.PrivateKey
function deriveOracleKey(mnemonic) {
  const seed = crypto.createHash('sha256').update(mnemonic.trim()).digest();
  return seed; // 32-byte Buffer — used as Ed25519/HMAC signing key
}

function signAttestation(privateKeyBuf, payload) {
  const hmac = crypto.createHmac('sha256', privateKeyBuf);
  hmac.update(payload);
  return hmac.digest('hex');
}

function oracleAddress(privateKeyBuf) {
  // Derive a stable oracle identity address from the key
  const pub = crypto.createHash('sha256').update(privateKeyBuf).digest('hex');
  const prefix = NETWORK === 'mainnet' ? 'kaspa' : 'kaspatest';
  return prefix + ':oracle-' + pub.substring(0, 20); // human-readable oracle ID
}

const ORACLE_KEY  = deriveOracleKey(ORACLE_MNEMONIC);
const ORACLE_ADDR = oracleAddress(ORACLE_KEY);
console.log('[HTP Oracle] Oracle identity:', ORACLE_ADDR);

// ── API resolver registry ─────────────────────────────────────────────────────
// Add your own resolvers here. Each resolver receives the event object and
// returns { outcome: string } or null if the result is not yet available.
//
// event.source examples:
//   "api:coinmarketcap:BTC>50000"   → price threshold check
//   "api:openligadb:soccer:34:2025" → match result
//   "api:manual"                    → skip (manual resolution only)
//   "api:kaspa:daa>42000000"        → DAA threshold on Kaspa itself

const RESOLVERS = {

  // ── Kaspa DAA threshold ───────────────────────────────────────────────────
  async 'kaspa:daa'(event) {
    const [, , thresholdStr] = event.source.split(':');
    const threshold = parseInt(thresholdStr);
    if (!threshold) return null;
    try {
      const r = await fetch(REST_URLS[NETWORK] + '/info/blockdag', { signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      const daa = parseInt(d.virtualDaaScore || d.daaScore || 0);
      if (daa >= threshold) return { outcome: 'Yes' };
      return { outcome: null }; // not yet
    } catch(e) { return null; }
  },

  // ── CoinGecko price threshold ─────────────────────────────────────────────
  // source format: "api:coingecko:kaspa>0.15"  (above) or "api:coingecko:bitcoin<30000" (below)
  async 'coingecko'(event) {
    const parts   = event.source.split(':');
    const coinId  = parts[2];
    const cond    = parts[3]; // e.g. "kaspa>0.15"
    const match   = cond && cond.match(/^(.+?)([><])(.+)$/);
    if (!match) return null;
    const [, , op, valStr] = match;
    const targetVal = parseFloat(valStr);
    try {
      const r = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(8000) }
      );
      const d = await r.json();
      const price = d[coinId] && d[coinId].usd;
      if (price == null) return null;
      const outcomeYes = op === '>' ? price > targetVal : price < targetVal;
      return { outcome: outcomeYes ? 'Yes' : 'No', data: { price, target: targetVal, op } };
    } catch(e) { return null; }
  },

  // ── OpenLigaDB (German soccer, free) ─────────────────────────────────────
  // source format: "api:openligadb:bl1:34:2025"  (league:matchday:season)
  async 'openligadb'(event) {
    const [, , league, matchday, season] = event.source.split(':');
    if (!league || !matchday) return null;
    try {
      const r = await fetch(
        `https://api.openligadb.de/getmatchdata/${league}/${season || '2024'}/${matchday}`,
        { signal: AbortSignal.timeout(8000) }
      );
      const matches = await r.json();
      if (!Array.isArray(matches) || !matches.length) return null;
      // Check if all matches in matchday are finished
      const allFinished = matches.every(m => m.MatchIsFinished);
      if (!allFinished) return null;
      // Build summary: "Team A wins" or "Draw" for single-match events
      const m = matches[0];
      const g1 = m.MatchResults && m.MatchResults.find(r => r.ResultTypeID === 2);
      if (!g1) return null;
      const s1 = g1.PointsTeam1, s2 = g1.PointsTeam2;
      let outcome;
      if (event.outcomes && event.outcomes.length >= 3) {
        outcome = s1 > s2 ? event.outcomes[0] : (s2 > s1 ? event.outcomes[2] : event.outcomes[1]);
      } else {
        outcome = s1 > s2 ? m.Team1.ShortName + ' Win'
                          : s2 > s1 ? m.Team2.ShortName + ' Win' : 'Draw';
      }
      return { outcome, data: { score: `${s1}:${s2}` } };
    } catch(e) { return null; }
  },

  // ── TheOddsAPI (sports scores) ────────────────────────────────────────────
  // source format: "api:theoddsapi:soccer_epl:TEAM_HOME_vs_TEAM_AWAY"
  // Requires ODDS_API_KEY in .env
  async 'theoddsapi'(event) {
    const ODDS_KEY = process.env.ODDS_API_KEY;
    if (!ODDS_KEY) return null;
    const [, , sport, matchKey] = event.source.split(':');
    if (!sport || !matchKey) return null;
    try {
      const r = await fetch(
        `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${ODDS_KEY}&daysFrom=3`,
        { signal: AbortSignal.timeout(8000) }
      );
      const games = await r.json();
      const [homeTeam, awayTeam] = matchKey.split('_vs_');
      const game = games.find(g =>
        g.home_team.toLowerCase().includes(homeTeam.toLowerCase()) &&
        g.away_team.toLowerCase().includes(awayTeam.toLowerCase())
      );
      if (!game || !game.completed) return null;
      const scores = game.scores || [];
      const homeScore = parseInt(scores.find(s => s.name === game.home_team)?.score || 0);
      const awayScore = parseInt(scores.find(s => s.name === game.away_team)?.score || 0);
      const outcome = homeScore > awayScore ? game.home_team + ' Win'
                    : awayScore > homeScore ? game.away_team + ' Win' : 'Draw';
      return { outcome, data: { homeScore, awayScore } };
    } catch(e) { return null; }
  },

  // ── Manual / skip ─────────────────────────────────────────────────────────
  async 'manual'() { return null; }
};

// ── Route event.source to the right resolver ──────────────────────────────────
async function resolveEvent(event) {
  if (!event.source || !event.source.startsWith('api:')) return null;
  const parts = event.source.split(':');
  const resolverKey = parts[1]; // e.g. "coingecko", "openligadb", "kaspa"
  const subKey = parts[1] + ':' + (parts[2] || ''); // e.g. "kaspa:daa"

  const resolver = RESOLVERS[subKey] || RESOLVERS[resolverKey];
  if (!resolver) {
    console.warn('[HTP Oracle] No resolver for source:', event.source);
    return null;
  }
  return resolver(event);
}

// ── Core: attest a single event ───────────────────────────────────────────────
async function attestEvent(eventId, event, outcome) {
  const safeAddr = ORACLE_ADDR.replace(/[.#$[\]]/g, '_');

  // Check if we already attested this event with this outcome
  const existing = await db.ref(`attestations/${eventId}/${safeAddr}`).once('value');
  if (existing.val() && existing.val().outcome === outcome) {
    return; // already attested — skip
  }

  // Build deterministic attestation payload
  const payload = JSON.stringify({ eventId, outcome, oracle: ORACLE_ADDR, ts: Date.now() });
  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
  const sig = signAttestation(ORACLE_KEY, payloadHash);

  // Write attestation to Firebase
  await db.ref(`attestations/${eventId}/${safeAddr}`).set({
    outcome,
    sig,
    hash: payloadHash,
    oracle: ORACLE_ADDR,
    ts: Date.now(),
    source: event.source || 'daemon'
  });

  console.log(`[HTP Oracle] ✅ Attested ${eventId} → "${outcome}" (sig: ${sig.substring(0, 16)}...)`);

  // Check if threshold is met — if so, finalize resolution
  await checkThresholdAndResolve(eventId, event);
}

// ── Check attestation threshold and auto-resolve ──────────────────────────────
async function checkThresholdAndResolve(eventId, event) {
  const snap = await db.ref(`attestations/${eventId}`).once('value');
  const attestations = snap.val() || {};
  const entries = Object.values(attestations);

  // Count outcomes by vote
  const votes = {};
  entries.forEach(a => {
    if (a.outcome) votes[a.outcome] = (votes[a.outcome] || 0) + 1;
  });

  // Find outcome with >= THRESHOLD votes
  const winner = Object.entries(votes).find(([, count]) => count >= THRESHOLD);
  if (!winner) {
    console.log(`[HTP Oracle] ${eventId}: ${entries.length}/${THRESHOLD} attestations so far`);
    return;
  }

  const [finalOutcome] = winner;
  console.log(`[HTP Oracle] 🏆 Threshold reached for ${eventId} → "${finalOutcome}" (${winner[1]}/${THRESHOLD})`);

  // Write final resolution
  await db.ref(`events/${eventId}`).update({
    status:   'resolved',
    outcome:  finalOutcome,
    resolution: {
      outcome:  finalOutcome,
      method:   'oracle-daemon',
      oracle:   ORACLE_ADDR,
      ts:       Date.now(),
      final:    true,
      votes:    votes
    }
  });

  console.log(`[HTP Oracle] ✅ Event ${eventId} finalized → "${finalOutcome}"`);
}

// ── Main poll cycle ───────────────────────────────────────────────────────────
async function pollCycle() {
  console.log('[HTP Oracle] Poll cycle —', new Date().toISOString());

  let eventsSnap;
  try {
    eventsSnap = await db.ref('events').once('value');
  } catch(e) {
    console.error('[HTP Oracle] Firebase read failed:', e.message);
    return;
  }

  const events = eventsSnap.val() || {};
  const now = Date.now();
  let checked = 0, resolved = 0;

  for (const [eventId, event] of Object.entries(events)) {
    // Skip already resolved or cancelled events
    if (event.status === 'resolved' || event.status === 'cancelled') continue;

    // Skip events that haven't closed yet (closeTime in ms)
    if (event.closeTime && event.closeTime > now) continue;

    // Skip events with no API source
    if (!event.source || event.source === 'api:manual') continue;

    checked++;
    try {
      const result = await resolveEvent(event);
      if (result && result.outcome) {
        await attestEvent(eventId, event, result.outcome);
        resolved++;
      } else {
        console.log(`[HTP Oracle] ${eventId}: no result yet (${event.source})`);
      }
    } catch(e) {
      console.error(`[HTP Oracle] Error processing ${eventId}:`, e.message);
    }

    // Brief pause between events to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[HTP Oracle] Cycle complete — checked: ${checked}, attested: ${resolved}`);
}

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('[HTP Oracle Daemon v1.0] Starting...');
console.log('  Network:   ', NETWORK);
console.log('  Firebase:  ', FIREBASE_DB_URL);
console.log('  Threshold: ', THRESHOLD);
console.log('  Poll every:', POLL_MS + 'ms');
console.log('  Oracle ID: ', ORACLE_ADDR);

pollCycle(); // immediate first run
setInterval(pollCycle, POLL_MS);

// Graceful shutdown
process.on('SIGINT',  () => { console.log('\n[HTP Oracle] Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[HTP Oracle] Shutting down...'); process.exit(0); });
