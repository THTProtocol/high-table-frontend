// htp-firebase-bridge.js — Temporary bridge layer, TN12 anchoring
(function(W) {
'use strict';

const DB = W.firebaseDB;
const BRIDGE_VERSION = '1.0';

W.HTP_FIREBASE_BRIDGE = {
  /** Every record: covenant_id + tx_hash + block_daa_score */
  writeAnchor: async function(path, covenantId, txHash, daaScore) {
    if (!DB) { console.error('[FB Bridge] no DB'); return; }
    const rec = {
      covenant_id: covenantId,
      tx_hash: txHash,
      block_daa_score: daaScore,
      v: BRIDGE_VERSION,
      ts: Date.now()
    };
    await DB.ref(path).set(rec);
    console.log('[FB Bridge] anchored', path, txHash, daaScore);
  },

  /** 60s disconnect timeout -> auto-cancel + refund */
  startTimeoutWatcher: function(escrowId, timeoutSec) {
    if (!DB) return;
    const ref = DB.ref('escrows/' + escrowId + '/heartbeat');
    ref.on('value', function(snap) {
      const val = snap.val();
      if (!val) return;
      const now = Date.now();
      if (now - val.ts > timeoutSec * 1000) {
        console.log('[FB Bridge] timeout for', escrowId, '- triggering cancel');
        W.dispatchEvent(new CustomEvent('htp:timeout:cancel', {detail:{escrowId:escrowId}}));
      }
    });
  },

  /** Prevent duplicate joins */
  lockJoin: async function(escrowId, playerAddress) {
    if (!DB) return false;
    const ref = DB.ref('escrows/' + escrowId + '/players');
    const snap = await ref.get();
    const players = snap.val() || {};
    if (Object.keys(players).length >= 2) return false;
    if (players[playerAddress]) return false;
    await DB.ref('escrows/' + escrowId + '/players/' + playerAddress).set({joined:true, ts:Date.now()});
    return true;
  },

  /** Audit rules enforcement */
  auditRecord: async function(escrowId) {
    if (!DB) return null;
    const snap = await DB.ref('escrows/' + escrowId).get();
    const rec = snap.val();
    if (!rec) return null;
    const checks = {
      hasCovenantId: !!rec.covenant_id,
      hasTxHash: !!rec.tx_hash,
      hasBlockScore: rec.block_daa_score > 0,
      notOverCapacity: (rec.players ? Object.keys(rec.players).length : 0) <= 2,
      versionMatch: rec.v === BRIDGE_VERSION
    };
    rec._audit = checks;
    return rec;
  }
};

})(window);
