/**
 * htp-cancel-flow.js — Skill Game Creator Cancel Flow
 * Checks HTPFee.skillGameCanCreatorCancel() before firing refund TX.
 * Depends on: htp-fee-engine.js, htp-covenant-escrow-v2.js
 * No Firebase required for the cancel TX itself.
 */
(function(W) {
  'use strict';

  function injectStyles() {
    if (document.getElementById('htp-cancel-style')) return;
    const s = document.createElement('style');
    s.id = 'htp-cancel-style';
    s.textContent = `
      .htp-cancel-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 10px 18px;
        background: rgba(239,68,68,0.1);
        border: 1px solid rgba(239,68,68,0.3);
        color: #ef4444; border-radius: 8px;
        font-weight: 700; font-size: 13px;
        cursor: pointer; transition: all 0.2s;
        font-family: 'Inter', sans-serif;
      }
      .htp-cancel-btn:hover { background: rgba(239,68,68,0.2); }
      .htp-cancel-btn:disabled { opacity: 0.35; cursor: not-allowed; }
      .htp-cancel-btn.loading { opacity: 0.6; cursor: wait; }
      .htp-cancel-confirm-modal {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);
        z-index: 9998;
        display: flex; align-items: center; justify-content: center;
      }
      .htp-cancel-confirm-card {
        background: #0f172a;
        border: 1px solid rgba(239,68,68,0.3);
        border-radius: 14px; padding: 28px;
        max-width: 380px; width: 90%;
        text-align: center;
        font-family: 'Inter', sans-serif;
        color: #e2e8f0;
        animation: htp-slide-up 0.2s ease;
      }
      .htp-cancel-confirm-card h3 {
        font-size: 20px; font-weight: 800; color: #fff;
        margin: 0 0 8px; letter-spacing: -0.02em;
      }
      .htp-cancel-confirm-card p {
        font-size: 13px; color: #94a3b8; line-height: 1.6; margin-bottom: 20px;
      }
      .htp-cancel-confirm-card .refund-amount {
        font-size: 28px; font-weight: 800; color: #49e8c2; margin-bottom: 6px;
      }
      .htp-cancel-confirm-card .refund-label {
        font-size: 11px; color: #64748b; margin-bottom: 20px;
      }
      .htp-cancel-modal-btns { display: flex; gap: 10px; }
      .htp-cancel-modal-btns button {
        flex: 1; padding: 11px; border-radius: 8px;
        border: none; font-weight: 700; font-size: 14px;
        cursor: pointer; font-family: 'Inter', sans-serif;
        transition: opacity 0.2s;
      }
      .htp-cancel-modal-btns .confirm { background: #ef4444; color: #fff; }
      .htp-cancel-modal-btns .back    { background: #1e293b; color: #94a3b8; }
      .htp-cancel-modal-btns button:hover { opacity: 0.88; }
      .htp-cancel-status {
        margin-top: 8px; font-size: 12px;
        padding: 8px 12px; border-radius: 6px;
        display: none;
      }
      .htp-cancel-status.ok   { background: rgba(73,232,194,0.1); color: #49e8c2; display: block; }
      .htp-cancel-status.err  { background: rgba(239,68,68,0.1);  color: #ef4444; display: block; }
      .htp-cancel-status.info { background: rgba(59,130,246,0.1); color: #3b82f6; display: block; }
    `;
    document.head.appendChild(s);
  }

  /**
   * Mount a cancel button into a container element.
   * @param {string} containerId
   * @param {object} opts — { matchId, stakeKas, opponentJoined, creatorAddress }
   */
  function mount(containerId, opts) {
    injectStyles();
    const container = document.getElementById(containerId);
    if (!container) return;

    const { matchId, stakeKas = 0, opponentJoined = false, creatorAddress } = opts || {};

    // Gate check via HTPFee
    const Fee = W.HTPFee;
    const canCancel = Fee
      ? Fee.skillGameCanCreatorCancel({ opponentJoined, creatorAddress, status: opponentJoined ? 'active' : 'pending' })
      : { allowed: !opponentJoined, reason: opponentJoined ? 'Game already started' : 'OK' };

    container.innerHTML = `
      <button class="htp-cancel-btn" id="htp-cancel-btn-${matchId}"
        ${!canCancel.allowed ? 'disabled title="' + canCancel.reason + '"' : ''}>
        ✕ Cancel Game
      </button>
      <div class="htp-cancel-status" id="htp-cancel-status-${matchId}"></div>
    `;

    if (!canCancel.allowed) {
      setStatus(matchId, 'err', canCancel.reason);
      return;
    }

    document.getElementById(`htp-cancel-btn-${matchId}`).addEventListener('click', function() {
      showConfirmModal(matchId, stakeKas, creatorAddress);
    });
  }

  function setStatus(matchId, type, msg) {
    const el = document.getElementById(`htp-cancel-status-${matchId}`);
    if (!el) return;
    el.className = 'htp-cancel-status ' + type;
    el.textContent = msg;
  }

  function showConfirmModal(matchId, stakeKas, creatorAddress) {
    // Check opponent hasn't just joined (live re-check)
    const latestCheck = async () => {
      if (W.firebase && W.firebase.database) {
        try {
          const snap = await W.firebase.database().ref(`matches/${matchId}`).once('value');
          const data = snap.val();
          if (data) {
            const Fee = W.HTPFee;
            const check = Fee
              ? Fee.skillGameCanCreatorCancel(data)
              : { allowed: !data.opponentJoined, reason: 'OK' };
            if (!check.allowed) {
              setStatus(matchId, 'err', check.reason);
              return false;
            }
          }
        } catch(e) {}
      }
      return true;
    };

    const modal = document.createElement('div');
    modal.className = 'htp-cancel-confirm-modal';
    modal.innerHTML = `
      <div class="htp-cancel-confirm-card">
        <h3>Cancel Game?</h3>
        <p>This will refund your full stake back to your wallet. You cannot undo this.</p>
        <div class="refund-amount">${stakeKas.toFixed(2)} KAS</div>
        <div class="refund-label">Refund amount (minus ~0.0001 KAS network fee)</div>
        <div class="htp-cancel-modal-btns">
          <button class="back" id="htp-cc-back">Back</button>
          <button class="confirm" id="htp-cc-confirm">Yes, Refund Me</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('htp-cc-back').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('htp-cc-confirm').addEventListener('click', async function() {
      this.textContent = 'Checking...';
      this.disabled    = true;

      const ok = await latestCheck();
      if (!ok) { modal.remove(); return; }

      this.textContent = 'Sending refund TX...';
      modal.remove();

      const btn = document.getElementById(`htp-cancel-btn-${matchId}`);
      if (btn) { btn.classList.add('loading'); btn.disabled = true; btn.textContent = 'Cancelling...'; }

      try {
        if (!W.cancelMatchEscrow) throw new Error('cancelMatchEscrow not loaded');
        const txId = await W.cancelMatchEscrow(matchId);
        if (txId) {
          setStatus(matchId, 'ok', '✓ Refunded! TX: ' + String(txId).substring(0,20) + '…');
          if (btn) { btn.textContent = '✓ Cancelled'; btn.style.opacity = '0.5'; }
          window.dispatchEvent(new CustomEvent('htp:match:cancelled', { detail: { matchId, txId } }));
        } else {
          setStatus(matchId, 'err', 'Refund failed — check console');
          if (btn) { btn.classList.remove('loading'); btn.disabled = false; btn.textContent = '✕ Cancel Game'; }
        }
      } catch(e) {
        setStatus(matchId, 'err', e.message);
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; btn.textContent = '✕ Cancel Game'; }
      }
    });
  }

  /**
   * Update cancel button state when match data changes (e.g. opponent joins).
   * Call this from your Firebase listener when match status changes.
   */
  function update(matchId, matchData) {
    const btn = document.getElementById(`htp-cancel-btn-${matchId}`);
    if (!btn) return;
    const Fee = W.HTPFee;
    const check = Fee
      ? Fee.skillGameCanCreatorCancel(matchData)
      : { allowed: !matchData.opponentJoined, reason: 'OK' };
    btn.disabled = !check.allowed;
    if (!check.allowed) {
      btn.title = check.reason;
      setStatus(matchId, 'err', check.reason);
    }
  }

  W.HTPCancelFlow = { mount, update };
  console.log('[HTPCancelFlow] loaded');
})(window);
