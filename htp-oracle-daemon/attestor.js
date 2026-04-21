/**
 * HTP Attestor – Firebase webhook listener & attestation broadcaster
 * -------------------------------------------------------------------
 * 1) Listens for Firebase webhooks indicating a result is ready
 * 2) Signs deterministic attestation using oracle-daemon-v2 helpers
 * 3) Unlocks escrow TX via Kaspa RPC
 * 4) Broadcasts TX and confirms inclusion
 * 5) Exponential back-off reconnect: 1→2→4→8→16→30s max
 */

'use strict';
require('dotenv').config();
const crypto      = require('crypto');
const fetch       = (...args) => import('node-fetch').then(m => m.default(...args));

const { signGameOutcome, ORACLE_ADDR } = require('./oracle-daemon-v2');

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
const KASPA_RPC_URL   = process.env.KASPA_RPC_URL || 'https://api-tn12.kaspa.org';

// --- Configurable backoff table (seconds) ---
const BACKOFF = [1, 2, 4, 8, 16, 30];
let backoffIdx = 0;

// --- Simple Firebase streaming via REST 'EventSource' style ---
async function listenFirebase(path, onData) {
  const url = `${FIREBASE_DB_URL}/${path}.json`;
  console.log(`[attestor] Listening ${url}`);
  while (true) {
    try {
      const res = await fetch(url, { timeout: 0 }); // long-poll
      if (!res.ok) throw new Error(`Firebase ${res.status}`);
      const data = await res.json();
      if (data) onData(data);
      backoffIdx = 0; // reset backoff on success
    } catch (e) {
      const wait = BACKOFF[Math.min(backoffIdx, BACKOFF.length-1)];
      console.error(`[attestor] Firebase error, retry in ${wait}s`, e.message);
      await new Promise(r => setTimeout(r, wait * 1000));
      backoffIdx++;
    }
  }
}

// --- Kaspa RPC wrappers (resolver only) ---
async function rpcPost(endpoint, body) {
  const url = `${KASPA_RPC_URL}${endpoint}`;
  const r = await fetch(url, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify(body),
    timeout: 10000
  });
  if (!r.ok) throw new Error(`RPC ${r.status}`);
  return r.json();
}

async function getDaaScore() {
  const info = await fetch(`${KASPA_RPC_URL}/info/blockdag`).then(r=>r.json());
  return parseInt(info.virtualDaaScore || info.daaScore || 0);
}

// --- Main webhook handler ---
async function handleWebhook(payload) {
  /* Expected payload shape from Firebase function/webhook:
     {
       escrowId: string,
       winner: string,        // player pubkey
       stateHash: string,     // hex 64
       unlockTx: {            // pre-built unsigned tx from game engine
         inputs:[...],
         outputs:[...]
       }
     }
  */
  if (!payload || !payload.escrowId) return;
  console.log(`[attestor] Webhook ${payload.escrowId}`);

  const { escrowId, winner, stateHash, unlockTx } = payload;
  const blockDaa = await getDaaScore();

  // 1) Deterministic sign
  const sig = signGameOutcome(ORACLE_ADDR, escrowId, winner, stateHash, blockDaa);
  console.log(`[attestor] Sig ${sig.slice(0,16)}...`);

  // 2) Post attestation to Firebase (oracle-daemon-v2 reads this)
  const attestation = { escrowId, winner, stateHash, sig, oracle:ORACLE_ADDR, ts:Date.now(), blockDaa };
  await fetch(`${FIREBASE_DB_URL}/attestations/${escrowId}/${ORACLE_ADDR.replace(/[.#$[\]]/g,'_')}.json`, {
    method:'PUT',
    headers:{'content-type':'application/json'},
    body: JSON.stringify(attestation)
  });

  // 3) Unlock & broadcast TX (placeholder – needs real Kaspa SDK for signing)
  // For now we assume the unlockTx is already signed by game-engine and we just broadcast
  try {
    const txid = await rpcPost('/transactions', unlockTx);
    console.log(`[attestor] Broadcast ${txid}`);
  } catch(e) {
    console.error(`[attestor] Broadcast failed`, e.message);
  }
}

// --- Start listener ---
console.log('[attestor] Starting Firebase webhook listener');
listenFirebase('webhooks/results', handleWebhook);