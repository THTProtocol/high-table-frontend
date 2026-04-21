/**
 * HTP Oracle Daemon v2.0 (M-of-N decentralised)
 * -----------------------------------------------
 * Stand-alone Node daemon with:
 * 1) Deterministic signing from game_state hash (blake2b)
 * 2) Public /health and /verify endpoints
 * 3) M-of-N scaffold (N=1 now, ready for N>1)
 * 4) Resolver-only RPC to Kaspa TN12
 * 5) Firebase webhook listener for async attestation pipeline
 */
'use strict';

const http          = require('http');
const crypto        = require('crypto');
const { blake2b }   = require('blakejs');    // npm install blakejs
const fetch         = (...args) => import('node-fetch').then(m => m.default(...args));
require('dotenv').config();

// --------------------------------------------------------------------------
// CONFIG
// --------------------------------------------------------------------------
const PORT           = parseInt(process.env.ORACLE_PORT || '8080');
const ORACLE_MNEMONIC= process.env.ORACLE_MNEMONIC;
const NETWORK        = process.env.NETWORK || 'tn12';
const FIREBASE_DB_URL= process.env.FIREBASE_DB_URL;
const KASPA_RPC_URL  = process.env.KASPA_RPC_URL || (NETWORK==='tn12'? 'https://api-tn12.kaspa.org' : 'https://api.kasparov.org');

const M_REQUIRED      = parseInt(process.env.M_REQUIRED || '1');  // M-of-N threshold
const ORACLE_INDEX    = parseInt(process.env.ORACLE_INDEX || '0'); // my index in oracle set

if (!ORACLE_MNEMONIC) {
  console.error('[oracle-v2] ORACLE_MNEMONIC missing');
  process.exit(1);
}

// --------------------------------------------------------------------------
// DETERMINISTIC KEY + ADDRESS
// --------------------------------------------------------------------------
function deriveOracleKey(mnemonic, idx=0) {
  // Deterministic 32-byte key from mnemonic + index
  const seed = blake2b(Buffer.from(mnemonic.trim() + idx), null, 32);
  return Buffer.from(seed);
}

function oracleAddress(keyBuf, network='tn12') {
  const pub = crypto.createHash('sha256').update(keyBuf).digest('hex');
  const prefix = network==='mainnet'? 'kaspa' : 'kaspatest';
  return `${prefix}:htp-oracle-${pub.slice(0,20)}`;
}

const ORACLE_KEY   = deriveOracleKey(ORACLE_MNEMONIC, ORACLE_INDEX);
const ORACLE_ADDR  = oracleAddress(ORACLE_KEY, NETWORK);

// --------------------------------------------------------------------------
// DETERMINISTIC SIGNING FROM GAME_STATE
// --------------------------------------------------------------------------
function signGameOutcome(keyBuf, escrowId, winner, stateHash, blockDaa) {
  const payload = Buffer.concat([
    Buffer.from(escrowId, 'utf8'),
    Buffer.from(winner, 'utf8'),
    Buffer.from(stateHash, 'hex'),       // 32-byte hash
    Buffer.from(blockDaa.toString(), 'utf8')
  ]);
  const hash = blake2b(payload, null, 32);
  const sig  = crypto.createHmac('sha256', keyBuf).update(hash).digest('hex');
  return sig; // 64-char hex
}

// --------------------------------------------------------------------------
// KASPA RPC HELPERS (resolver only)
// --------------------------------------------------------------------------
async function rpcGet(endpoint) {
  const url = `${KASPA_RPC_URL}${endpoint}`;
  const r   = await fetch(url, { timeout: 5000 });
  if (!r.ok) throw new Error(`RPC ${r.status}`);
  return r.json();
}

async function getDaaScore() {
  const info = await rpcGet('/info/blockdag');
  return parseInt(info.virtualDaaScore || info.daaScore || 0);
}

// --------------------------------------------------------------------------
// HTTP SERVER – PUBLIC ENDPOINTS
// --------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status:'ok', oracle:ORACLE_ADDR, network:NETWORK, m:M_REQUIRED }));
  }

  if (url.pathname === '/verify') {
    const escrow = url.searchParams.get('escrow');
    const sig    = url.searchParams.get('sig');
    if (!escrow || !sig) {
      res.writeHead(400); return res.end('need escrow & sig');
    }
    // TODO: verify against Firebase or local record
    res.writeHead(200, { 'content-type':'application/json' });
    return res.end(JSON.stringify({ escrow, valid:null }));
  }

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, () => console.log(`[oracle-v2] HTTP ${PORT}`));

// --------------------------------------------------------------------------
// MAIN LOOP – M-of-N SC AFFOLD
// --------------------------------------------------------------------------
async function daemonLoop() {
  console.log('[oracle-v2] Daemon loop');
  // TODO: fetch active escrows from Firebase
  // For each, if M-of-N not met, attempt to attest
  // For now scaffold only: N=1, so any attestation resolves immediately.
}

setInterval(daemonLoop, 30_000);
daemonLoop();

module.exports = { signGameOutcome, ORACLE_ADDR, ORACLE_KEY };