/**
 * htp-settlement-overlay.js — Settlement Preview + Result Overlay
 * Shows exact payout breakdown before TX fires, and win/loss/draw result.
 * Depends on: htp-fee-engine.js (HTPFee)
 * No Firebase required.
 */
(function(W) {
  'use strict';

  function injectStyles() {
    if (document.getElementById('htp-overlay-style')) return;
    const s = document.createElement('style');
    s.id = 'htp-overlay-style';
    s.textContent = `
      .htp-overlay-backdrop {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.75);
        backdrop-filter: blur(6px);
        z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        animation: htp-fade-in 0.2s ease;
      }
      @keyframes htp-fade-in { from { opacity:0 } to { opacity:1 } }
      @keyframes htp-slide-up { from { transform:translateY(24px);opacity:0 } to { transform:translateY(0);opacity:1 } }
      .htp-overlay-card {
        background: #0f172a;
        border: 1px solid rgba(73,232,194,0.25);
        border-radius: 16px;
        padding: 32px;
        max-width: 420px;
        width: 90%;
        text-align: center;
        animation: htp-slide-up 0.25s ease;
        font-family: 'Inter', sans-serif;
        color: #e2e8f0;
      }
      .htp-overlay-icon {
        font-size: 56px;
        margin-bottom: 12px;
        display: block;
      }
      .htp-overlay-title {
        font-size: 26px;
        font-weight: 800;
        margin-bottom: 6px;
        letter-spacing: -0.02em;
      }
      .htp-overlay-title.win  { color: #49e8c2; }
      .htp-overlay-title.lose { color: #ef4444; }
      .htp-overlay-title.draw { color: #f59e0b; }
      .htp-overlay-title.preview { color: #3b82f6; }
      .htp-overlay-subtitle {
        font-size: 13px;
        color: #64748b;
        margin-bottom: 24px;
      }
      .htp-breakdown {
        background: #1e293b;
        border-radius: 10px;
        padding: 16px;
        margin-bottom: 20px;
        text-align: left;
      }
      .htp-breakdown-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 5px 0;
        font-size: 13px;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .htp-breakdown-row:last-child { border-bottom: none; }
      .htp-breakdown-row .bd-label { color: #94a3b8; }
      .htp-breakdown-row .bd-value { font-weight: 600; color: #e2e8f0; }
      .htp-breakdown-row .bd-value.green  { color: #49e8c2; }
      .htp-breakdown-row .bd-value.red    { color: #ef4444; }
      .htp-breakdown-row .bd-value.yellow { color: #f59e0b; }
      .htp-breakdown-row .bd-value.muted  { color: #64748b; font-size: 11px; }
      .htp-overlay-payout-big {
        font-size: 36px;
        font-weight: 800;
        color: #49e8c2;
        margin-bottom: 4px;
      }
      .htp-overlay-payout-big.lose { color: #ef4444; }
      .htp-overlay-payout-big.draw { color: #f59e0b; }
      .htp-overlay-buttons {
        display: flex; gap: 10px;
      }
      .htp-overlay-btn {
        flex: 1;
        padding: 12px;
        border-radius: 8px;
        border: none;
        font-weight: 700;
        font-size: 14px;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.1s;
      }
      .htp-overlay-btn:active { transform: scale(0.97); }
      .htp-overlay-btn.primary {
        background: linear-gradient(135deg, #49e8c2, #3b82f6);
        color: #0f172a;
      }
      .htp-overlay-btn.secondary {
        background: #1e293b;
        color: #94a3b8;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .htp-overlay-btn:hover { opacity: 0.9; }
      .htp-tx-link {
        font-size: 11px;
        color: #475569;
        margin-top: 14px;
        word-break: break-all;
      }
      .htp-tx-link a { color: #3b82f6; text-decoration: none; }
      .htp-tx-link a:hover { text-decoration: underline; }
    `;
    document.head.appendChild(s);
  }

  function getExplorer(txId) {
    const net = W.activeNet || W.HTP_NETWORK || 'mainnet';
    const base = net === 'mainnet'
      ? 'https://explorer.kaspa.org/txs/'
      : 'https://explorer-tn12.kaspa.org/txs/';
    return base + txId;
  }

  function show(opts) {
    // opts = { type, matchId, stakeKas, winner, playerA, playerB, txId, isMaximizer, betKas, odds, onConfirm, onCancel }
    injectStyles();

    const Fee = W.HTPFee;
    if (!Fee) { console.error('[SettlementOverlay] HTPFee not loaded'); return; }

    const { type = 'preview', matchId, stakeKas = 0, winner, playerA, playerB,
            txId, isMaximizer, betKas, odds = 2, onConfirm, onCancel } = opts;

    let icon, titleText, titleClass, payoutBig, payoutClass, subtitle, rows = [], primaryLabel, secondaryLabel;

    if (type === 'win') {
      icon = '🏆'; titleClass = 'win'; titleText = 'You Won!';
      const calc = Fee.skillGameSettle(stakeKas);
      subtitle = `Match ${matchId || ''} settled on-chain`;
      payoutBig = '+' + calc.winnerPayout.toFixed(2) + ' KAS'; payoutClass = '';
      rows = [
        { label: 'Total pool',     value: calc.totalPool.toFixed(2) + ' KAS', cls: '' },
        { label: 'Protocol fee',   value: '−' + calc.protocolFee.toFixed(2) + ' KAS', cls: 'muted' },
        { label: 'Your payout',    value: calc.winnerPayout.toFixed(2) + ' KAS', cls: 'green' },
        { label: 'Treasury',       value: Fee.treasuryAddress().substring(0,18)+'…', cls: 'muted' },
      ];
      primaryLabel = txId ? 'View on Explorer' : 'Claim Payout';
      secondaryLabel = 'Close';

    } else if (type === 'lose') {
      icon = '💀'; titleClass = 'lose'; titleText = 'You Lost';
      subtitle = `Match ${matchId || ''} settled`;
      payoutBig = '0 KAS'; payoutClass = 'lose';
      rows = [
        { label: 'Result', value: 'Loss', cls: 'red' },
        { label: 'Stake',  value: stakeKas.toFixed(2) + ' KAS lost', cls: 'muted' },
      ];
      if (isMaximizer) {
        const calc = Fee.maximizerLoseSettle(betKas || stakeKas);
        rows = [
          { label: 'Your bet',       value: (betKas||stakeKas).toFixed(2) + ' KAS', cls: '' },
          { label: 'Hedge (50%)',    value: calc.hedgeAmount.toFixed(2) + ' KAS', cls: 'yellow' },
          { label: 'Hedge fee (30%)',value: '−' + calc.protocolFee.toFixed(2) + ' KAS', cls: 'muted' },
          { label: 'Claimable',      value: calc.claimable.toFixed(2) + ' KAS', cls: 'yellow' },
        ];
        payoutBig = 'Claim ' + (betKas||stakeKas) * 0.35 |0 + ' KAS'; payoutClass = 'draw';
        titleText = 'You Lost — Claim Hedge';
      }
      primaryLabel = isMaximizer ? 'Claim Hedge' : 'Close';
      secondaryLabel = 'Close';

    } else if (type === 'draw') {
      icon = '🤝'; titleClass = 'draw'; titleText = 'Draw';
      const half = stakeKas; // each gets their stake back
      subtitle = `Match ${matchId || ''} — stakes returned`;
      payoutBig = half.toFixed(2) + ' KAS each'; payoutClass = 'draw';
      rows = [
        { label: 'Each player gets', value: half.toFixed(2) + ' KAS', cls: 'yellow' },
        { label: 'Protocol fee',     value: 'None (draw)', cls: 'muted' },
      ];
      primaryLabel = 'Claim Refund'; secondaryLabel = 'Close';

    } else {
      // preview — before TX fires
      icon = '📋'; titleClass = 'preview'; titleText = 'Settlement Preview';
      subtitle = 'Review before signing';
      const calc = Fee.skillGameSettle(stakeKas);
      payoutBig = calc.winnerPayout.toFixed(2) + ' KAS'; payoutClass = '';
      rows = [
        { label: 'Stake each',     value: stakeKas.toFixed(2) + ' KAS', cls: '' },
        { label: 'Total pool',     value: calc.totalPool.toFixed(2) + ' KAS', cls: '' },
        { label: 'Protocol fee',   value: calc.protocolFee.toFixed(2) + ' KAS (2%)', cls: 'muted' },
        { label: 'Winner gets',    value: calc.winnerPayout.toFixed(2) + ' KAS', cls: 'green' },
        { label: 'Winner address', value: (winner||'TBD').substring(0,16)+'…', cls: 'muted' },
        { label: 'Treasury',       value: Fee.treasuryAddress().substring(0,18)+'…', cls: 'muted' },
      ];
      primaryLabel = 'Confirm & Sign'; secondaryLabel = 'Cancel';
    }

    const rowsHtml = rows.map(r =>
      `<div class="htp-breakdown-row"><span class="bd-label">${r.label}</span><span class="bd-value ${r.cls}">${r.value}</span></div>`
    ).join('');

    const txHtml = txId
      ? `<div class="htp-tx-link">TX: <a href="${getExplorer(txId)}" target="_blank">${txId.substring(0,24)}…</a></div>`
      : '';

    const backdrop = document.createElement('div');
    backdrop.className = 'htp-overlay-backdrop';
    backdrop.innerHTML = `
      <div class="htp-overlay-card">
        <span class="htp-overlay-icon">${icon}</span>
        <div class="htp-overlay-title ${titleClass}">${titleText}</div>
        <div class="htp-overlay-subtitle">${subtitle}</div>
        <div class="htp-overlay-payout-big ${payoutClass}">${payoutBig}</div>
        <div class="htp-breakdown">${rowsHtml}</div>
        <div class="htp-overlay-buttons">
          <button class="htp-overlay-btn secondary" id="htp-overlay-cancel">${secondaryLabel}</button>
          <button class="htp-overlay-btn primary"   id="htp-overlay-confirm">${primaryLabel}</button>
        </div>
        ${txHtml}
      </div>
    `;
    document.body.appendChild(backdrop);

    document.getElementById('htp-overlay-confirm').addEventListener('click', function() {
      if (txId) { window.open(getExplorer(txId), '_blank'); }
      backdrop.remove();
      if (typeof onConfirm === 'function') onConfirm();
    });
    document.getElementById('htp-overlay-cancel').addEventListener('click', function() {
      backdrop.remove();
      if (typeof onCancel === 'function') onCancel();
    });
    backdrop.addEventListener('click', function(e) {
      if (e.target === backdrop) { backdrop.remove(); if (typeof onCancel === 'function') onCancel(); }
    });

    return backdrop;
  }

  W.HTPSettlementOverlay = { show };
  console.log('[HTPSettlementOverlay] loaded');
})(window);
