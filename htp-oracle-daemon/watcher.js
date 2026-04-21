/**
 * watcher.js v3.1 — HTP Oracle Settlement Watcher
 * htp-oracle-daemon/watcher.js
 */

require('dotenv').config();
const admin = require('firebase-admin');
const path  = require('path');

const serviceAccountPath = process.env.SERVICE_ACCOUNT_KEY_PATH
  || path.join(__dirname, 'serviceAccountKey.json');

let serviceAccount;
try {
  serviceAccount = require(serviceAccountPath);
} catch(e) {
  console.error('[WATCHER] serviceAccountKey.json not found at', serviceAccountPath);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL,
});

const db = admin.database();

// ── Config ────────────────────────────────────────────────────────────────
const NETWORK_ID = process.env.KASPA_NETWORK || 'mainnet';
const LOCK_TTL_MS = 60_000;

// Treasury addresses — hardcoded, not env-configurable (security)
const TREASURY = {
  'mainnet':    'kaspa:qza6ah0lfqf33c9m00ynkfeettuleluvnpyvmssm5pzz7llwy2ka5nkka4fel',
  'testnet-12': 'kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m',
};

// Fee rules (must match htp-fee-engine.js exactly)
const FEES = {
  SKILL_GAME_WIN_PCT:       0.02,   // 2% of total pool, paid by winner
  EVENT_WIN_PCT:            0.02,   // 2% of net winnings
  MAXIMIZER_HEDGE_LOSS_PCT: 0.30,   // 30% of hedge if maximizer loses
  MAXIMIZER_POOL_PCT:       0.50,   // 50% of maximizer bet goes to pool
};

function treasuryAddr() { return TREASURY[NETWORK_ID] || TREASURY['mainnet']; }

log(`HTP Settlement Watcher v3.1 starting...`);
log(`Network: ${NETWORK_ID}`);
log(`Firebase: ${process.env.FIREBASE_DB_URL}`);
log(`Treasury: ${treasuryAddr()}`);
log(`Fees: skill_win=2% | event_win=2% | maximizer_hedge_loss=30%`);

// ── Logging ───────────────────────────────────────────────────────────────
function log(msg, level = 'INFO') {
  console.log(`[${new Date().toISOString()}] [${level}] [WATCHER] ${msg}`);
}
function logWarn(msg)  { log(msg, 'WARN'); }
function logError(msg) { log(msg, 'ERROR'); }

// ── Settlement lock ───────────────────────────────────────────────────────
const activeLocks = new Map();
function acquireLock(matchId) {
  const now = Date.now();
  const ex = activeLocks.get(matchId);
  if (ex && now - ex < LOCK_TTL_MS) { logWarn(`Lock active for ${matchId}`); return false; }
  activeLocks.set(matchId, now);
  return true;
}
function releaseLock(matchId) { activeLocks.delete(matchId); }

// ── Skill game settlement ─────────────────────────────────────────────────
function calcSkillGameFees(stakeKas) {
  const totalPool   = stakeKas * 2;
  const protocolFee = totalPool * FEES.SKILL_GAME_WIN_PCT;
  const winnerPayout = totalPool - protocolFee;
  return { totalPool, protocolFee, winnerPayout };
}

// ── Maximizer win settlement ───────────────────────────────────────────────
function calcMaximizerWin(betKas, odds) {
  const grossPayout  = betKas * odds;
  const netWinnings  = grossPayout - betKas;
  const protocolFee  = netWinnings * FEES.EVENT_WIN_PCT;
  const netPayout    = grossPayout - protocolFee;
  return { grossPayout, protocolFee, netPayout };
}

// ── Maximizer lose settlement ──────────────────────────────────────────────
function calcMaximizerLose(betKas) {
  const hedgeAmount  = betKas * FEES.MAXIMIZER_POOL_PCT;
  const protocolFee  = hedgeAmount * FEES.MAXIMIZER_HEDGE_LOSS_PCT;
  const claimable    = hedgeAmount - protocolFee;
  return { hedgeAmount, protocolFee, claimable };
}

// ── Skill game settlement ─────────────────────────────────────────────────
async function settleSkillGame(matchId, matchData) {
  if (!acquireLock(matchId)) return;
  log(`Settling skill game ${matchId}`);
  try {
    const winner        = matchData.winner;
    const stakeKas      = parseFloat(matchData.stakeKas || 0);
    const winnerAddress = winner === 'playerA' ? matchData.playerA : matchData.playerB;

    if (!winner || !winnerAddress || stakeKas <= 0) {
      logWarn(`Skill game ${matchId} missing fields — needs_review`);
      await db.ref(`matches/${matchId}`).update({ status: 'needs_review', reviewReason: 'missing_fields' });
      releaseLock(matchId); return;
    }

    const { totalPool, protocolFee, winnerPayout } = calcSkillGameFees(stakeKas);
    log(`Skill game ${matchId}: winner=${winner} payout=${winnerPayout.toFixed(4)} KAS fee=${protocolFee.toFixed(4)} KAS → ${treasuryAddr()}`);

    await db.ref(`settlements/${matchId}`).set({
      matchId, type: 'skill_game',
      winner, winnerAddress,
      stakeKas, totalPool, protocolFee, winnerPayout,
      treasuryAddress: treasuryAddr(),
      networkId: NETWORK_ID,
      status: 'pending_tx',
      settledAt: admin.database.ServerValue.TIMESTAMP,
      settledByWatcher: 'v3.1',
    });
    await db.ref(`matches/${matchId}`).update({ status: 'settling', settlementAt: admin.database.ServerValue.TIMESTAMP });
    log(`Settlement record written: ${matchId}`);
  } catch(err) {
    logError(`Skill game settlement failed ${matchId}: ${err.message}`);
  } finally { releaseLock(matchId); }
}

// ── Event settlement (parimutuel) ─────────────────────────────────────────
async function settleEvent(eventId, eventData) {
  if (!acquireLock(eventId)) return;
  log(`Settling event ${eventId}`);
  try {
    const bets = eventData.bets || {};
    const winningOutcome = eventData.result;
    const totalPool = Object.values(bets).reduce((s, b) => s + (b.isMaximizer ? b.betKas * 0.5 : b.betKas), 0);

    const settlements = {};
    for (const [userId, bet] of Object.entries(bets)) {
      const won = bet.outcome === winningOutcome;
      if (bet.isMaximizer) {
        if (won) {
          const odds = totalPool / (totalPool * (bet.betKas * 0.5 / totalPool));
          const r = calcMaximizerWin(bet.betKas, eventData.finalOdds?.[userId] || 2);
          settlements[userId] = { type: 'maximizer_win', ...r, treasuryAddress: treasuryAddr() };
        } else {
          const r = calcMaximizerLose(bet.betKas);
          settlements[userId] = { type: 'maximizer_lose', ...r, treasuryAddress: treasuryAddr() };
        }
      } else {
        if (won) {
          const odds = eventData.finalOdds?.[userId] || 2;
          const gross = bet.betKas * odds;
          const fee   = (gross - bet.betKas) * FEES.EVENT_WIN_PCT;
          settlements[userId] = {
            type: 'standard_win', netPayout: gross - fee, protocolFee: fee,
            treasuryAddress: treasuryAddr()
          };
        } else {
          settlements[userId] = { type: 'standard_lose', payout: 0 };
        }
      }
    }

    await db.ref(`settlements/${eventId}`).set({
      eventId, type: 'event', winningOutcome,
      settlements, networkId: NETWORK_ID,
      status: 'pending_tx',
      settledAt: admin.database.ServerValue.TIMESTAMP,
      settledByWatcher: 'v3.1',
    });
    await db.ref(`events/${eventId}`).update({ status: 'settling', settlementAt: admin.database.ServerValue.TIMESTAMP });
    log(`Event settlement written: ${eventId}`);
  } catch(err) {
    logError(`Event settlement failed ${eventId}: ${err.message}`);
  } finally { releaseLock(eventId); }
}

// ── Watchers ──────────────────────────────────────────────────────────────

// Skill games: completed
db.ref('matches').orderByChild('status').equalTo('completed')
  .on('child_added', async (snap) => {
    const id = snap.key; const data = snap.val();
    if (!data || data.settlementAt) return;
    await settleSkillGame(id, data);
  });

// Matches: DAA deadline expired
db.ref('matches').on('child_changed', async (snap) => {
  const id = snap.key; const data = snap.val();
  if (!data) return;
  if (data.deadlineExpired && data.status === 'active' && !data.settlementAt) {
    log(`DAA deadline expired: ${id} — settling as timeout`);
    await settleSkillGame(id, { ...data, winner: 'timeout' });
  }
});

// Events: completed
db.ref('events').orderByChild('status').equalTo('completed')
  .on('child_added', async (snap) => {
    const id = snap.key; const data = snap.val();
    if (!data || data.settlementAt) return;
    await settleEvent(id, data);
  });

// Manual settlement requests
db.ref('settlement_requests').on('child_added', async (snap) => {
  const req = snap.val(); const id = req?.matchId || req?.eventId;
  if (!id) return;
  log(`Manual settlement request: ${id}`);
  if (req.type === 'event') {
    const s = await db.ref(`events/${id}`).get();
    if (s.exists()) await settleEvent(id, { ...s.val(), ...req });
  } else {
    const s = await db.ref(`matches/${id}`).get();
    if (s.exists()) await settleSkillGame(id, { ...s.val(), ...req });
  }
  await snap.ref.remove();
});

// ── Heartbeat ─────────────────────────────────────────────────────────────
setInterval(async () => {
  await db.ref('watcher/heartbeat').set({
    ts: admin.database.ServerValue.TIMESTAMP,
    version: 'v3.1', network: NETWORK_ID,
    treasury: treasuryAddr(),
    activeLocks: activeLocks.size,
  });
}, 30_000);

// ── Graceful shutdown ─────────────────────────────────────────────────────
async function shutdown(signal) {
  log(`${signal} — shutting down`);
  db.ref('matches').off(); db.ref('events').off(); db.ref('settlement_requests').off();
  await db.ref('watcher/heartbeat').update({ status: 'offline', ts: admin.database.ServerValue.TIMESTAMP });
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log('Ready.');
