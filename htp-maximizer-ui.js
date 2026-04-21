/**
 * htp-maximizer-ui.js — Maximizer Bet UI Component
 * Renders live 50/50 split preview + cap checker
 * Depends on: htp-fee-engine.js (HTPFee)
 * No Firebase required.
 */
(function(W) {
  'use strict';

  // ── CSS ──────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('htp-maximizer-style')) return;
    const s = document.createElement('style');
    s.id = 'htp-maximizer-style';
    s.textContent = `
      .htp-maximizer-panel {
        background: #0f172a;
        border: 1px solid rgba(73,232,194,0.2);
        border-radius: 12px;
        padding: 20px;
        margin: 12px 0;
        font-family: 'Inter', sans-serif;
        color: #e2e8f0;
      }
      .htp-maximizer-panel h3 {
        color: #49e8c2;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin: 0 0 16px 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .htp-maximizer-panel h3::before {
        content: '⚡';
      }
      .htp-mode-buttons {
        display: flex;
        gap: 10px;
        margin-bottom: 16px;
      }
      .htp-mode-btn {
        flex: 1;
        padding: 8px 12px;
        background: #1e293b;
        border: 1px solid rgba(73,232,194,0.3);
        border-radius: 8px;
        color: #cbd5e1;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
      }
      .htp-mode-btn.active {
        background: rgba(73,232,194,0.2);
        border-color: #49e8c2;
        color: #49e8c2;
      }
      .htp-mode-btn:hover {
        opacity: 0.8;
      }
      .htp-odds-impact {
        font-size: 11px;
        color: #64748b;
        margin-bottom: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .htp-odds-impact.live {
        color: #49e8c2;
      }
      .htp-hedge-claim {
        background: rgba(245,158,11,0.1);
        border: 1px solid rgba(245,158,11,0.3);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 12px;
        color: #f59e0b;
        margin-bottom: 14px;
        line-height: 1.6;
      }
      .htp-hedge-claim strong {
        color: #fff;
      }
      .htp-maximizer-badge {
        background: linear-gradient(135deg, #49e8c2, #3b82f6);
        color: #0f172a;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 6px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .htp-progress-bar-wrap {
        margin-bottom: 12px;
      }
      .htp-progress-bar-label {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #64748b;
        margin-bottom: 4px;
      }
      .htp-progress-bar-track {
        background: #1e293b;
        border-radius: 99px;
        height: 4px;
        overflow: hidden;
      }
      .htp-progress-bar-fill {
        height: 100%;
        border-radius: 99px;
        background: linear-gradient(90deg, #49e8c2, #3b82f6);
        transition: width 0.3s ease;
      }
      .htp-bet-input-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 16px;
      }
      .htp-bet-input {
        flex: 1;
        background: #1e293b;
        border: 1px solid rgba(73,232,194,0.3);
        border-radius: 8px;
        padding: 10px 14px;
        color: #fff;
        font-size: 16px;
        font-weight: 600;
        outline: none;
        transition: border-color 0.2s;
      }
      .htp-bet-input:focus { border-color: #49e8c2; }
      .htp-bet-input::placeholder { color: #475569; }
      .htp-kas-label {
        color: #49e8c2;
        font-weight: 700;
        font-size: 14px;
        min-width: 36px;
      }
      .htp-split-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 14px;
      }
      .htp-split-box {
        background: #1e293b;
        border-radius: 8px;
        padding: 12px;
        text-align: center;
      }
      .htp-split-box .label {
        font-size: 11px;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 4px;
      }
      .htp-split-box .value {
        font-size: 18px;
        font-weight: 700;
        color: #fff;
      }
      .htp-split-box.pool .value  { color: #49e8c2; }
      .htp-split-box.hedge .value { color: #f59e0b; }
      .htp-cap-bar-wrap {
        margin-bottom: 14px;
      }
      .htp-cap-bar-label {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #64748b;
        margin-bottom: 5px;
      }
      .htp-cap-bar-track {
        background: #1e293b;
        border-radius: 99px;
        height: 6px;
        overflow: hidden;
      }
      .htp-cap-bar-fill {
        height: 100%;
        border-radius: 99px;
        background: linear-gradient(90deg, #49e8c2, #3b82f6);
        transition: width 0.3s ease;
      }
      .htp-cap-bar-fill.over { background: linear-gradient(90deg, #ef4444, #f59e0b); }
      .htp-maximizer-status {
        font-size: 12px;
        padding: 8px 12px;
        border-radius: 8px;
        margin-bottom: 14px;
        font-weight: 500;
      }
      .htp-maximizer-status.ok      { background: rgba(73,232,194,0.1); color: #49e8c2; border: 1px solid rgba(73,232,194,0.2); }
      .htp-maximizer-status.warn    { background: rgba(245,158,11,0.1); color: #f59e0b; border: 1px solid rgba(245,158,11,0.2); }
      .htp-maximizer-status.blocked { background: rgba(239,68,68,0.1);  color: #ef4444; border: 1px solid rgba(239,68,68,0.2); }
      .htp-payout-preview {
        background: #1e293b;
        border-radius: 8px;
        padding: 12px 14px;
        font-size: 12px;
        color: #94a3b8;
        margin-bottom: 14px;
        line-height: 1.8;
      }
      .htp-payout-preview .win  { color: #49e8c2; font-weight: 600; }
      .htp-payout-preview .lose { color: #f59e0b; font-weight: 600; }
      .htp-payout-preview .fee  { color: #64748b; }
      .htp-maximizer-toggle {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
        cursor: pointer;
        user-select: none;
      }
      .htp-toggle-switch {
        width: 40px; height: 22px;
        background: #334155;
        border-radius: 99px;
        position: relative;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      .htp-toggle-switch.on { background: #49e8c2; }
      .htp-toggle-switch::after {
        content: '';
        position: absolute;
        width: 16px; height: 16px;
        background: #fff;
        border-radius: 50%;
        top: 3px; left: 3px;
        transition: transform 0.2s;
      }
      .htp-toggle-switch.on::after { transform: translateX(18px); }
      .htp-toggle-label { font-size: 13px; color: #cbd5e1; }
      .htp-toggle-label strong { color: #49e8c2; }
      .htp-place-btn {
        width: 100%;
        padding: 12px;
        background: linear-gradient(135deg, #49e8c2, #3b82f6);
        color: #0f172a;
        font-weight: 700;
        font-size: 14px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.1s;
        letter-spacing: 0.03em;
      }
      .htp-place-btn:hover   { opacity: 0.9; }
      .htp-place-btn:active  { transform: scale(0.98); }
      .htp-place-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    `;
    document.head.appendChild(s);
  }

  // Utility function to render maximizer badge on lobby cards
  function addMaximizerBadge(marketId) {
    // Look for market card by data-market-id and add badge
    const card = document.querySelector(`[data-market-id="${marketId}"] .market-card-title`);
    if (card && !card.querySelector('.htp-maximizer-badge')) {
      const badge = document.createElement('span');
      badge.className = 'htp-maximizer-badge';
      badge.textContent = 'Maximizer ⚡';
      card.appendChild(badge);
    }
  }

  // ── Core renderer ─────────────────────────────────────────────────────────
  function render(containerId, eventConfig) {
    injectStyles();
    const container = document.getElementById(containerId);
    if (!container) { console.warn('[MaximizerUI] container not found:', containerId); return; }

    // eventConfig = { eventId, maxMaximizerPct, expectedVolume, currentVolume, currentMaximizerTotal, currentOdds }
    const cfg = Object.assign({
      eventId: 'unknown',
      maxMaximizerPct: 0.10,
      expectedVolume: 100000,
      currentVolume: 0,
      currentMaximizerTotal: 0,
      currentOdds: 2.0,
    }, eventConfig || {});

    container.innerHTML = `
      <div class="htp-maximizer-panel">
        <h3>Place Bet</h3>
        <div class="htp-mode-buttons" id="htp-mode-buttons">
          <div class="htp-mode-btn active" data-mode="standard" id="htp-btn-standard">Standard Bet</div>
          <div class="htp-mode-btn" data-mode="maximizer" id="htp-btn-maximizer">Maximizer ⚡</div>
        </div>
        <div class="htp-bet-input-row">
          <input class="htp-bet-input" id="htp-mx-amount" type="number" min="1" step="1" placeholder="Enter KAS amount" />
          <span class="htp-kas-label">KAS</span>
        </div>
        <div class="htp-odds-impact" id="htp-odds-impact"></div>
        <div class="htp-split-grid" id="htp-mx-split" style="display:none">
          <div class="htp-split-box pool">
            <div class="label">→ Pool (50%)</div>
            <div class="value" id="htp-mx-pool">0 KAS</div>
          </div>
          <div class="htp-split-box hedge">
            <div class="label">→ Hedge UTXO (50%)</div>
            <div class="value" id="htp-mx-hedge">0 KAS</div>
          </div>
        </div>
        <div class="htp-hedge-claim" id="htp-hedge-claim" style="display:none">
          <strong>If you lose:</strong> <span id="hedge-return">0 KAS</span> back,
          <span id="hedge-fee">0 KAS</span> to protocol<br>
          <small>Covenant-locked UTXO available for claim</small>
        </div>
        <div class="htp-cap-bar-wrap" id="htp-mx-capwrap" style="display:none">
          <div class="htp-cap-bar-label">
            <span>Maximizer capacity</span>
            <span id="htp-mx-cap-text">— / —</span>
          </div>
          <div class="htp-cap-bar-track">
            <div class="htp-cap-bar-fill" id="htp-mx-capfill" style="width:0%"></div>
          </div>
        </div>
        <div class="htp-progress-bar-wrap" id="htp-mx-progress-wrap" style="display:none">
          <div class="htp-progress-bar-label">
            <span>Creator event usage</span>
            <span id="htp-mx-progress-text">0 / —</span>
          </div>
          <div class="htp-progress-bar-track">
            <div class="htp-progress-bar-fill" id="htp-mx-progress-fill" style="width:0%"></div>
          </div>
        </div>
        <div class="htp-maximizer-status ok" id="htp-mx-status" style="display:none"></div>
        <div class="htp-payout-preview" id="htp-mx-preview" style="display:none"></div>
        <button class="htp-place-btn" id="htp-mx-btn" disabled>Enter amount to continue</button>
      </div>
    `;

    let isMaximizer = false;

    const modeButtons   = document.getElementById('htp-mode-buttons');
    const btnStandard   = document.getElementById('htp-btn-standard');
    const btnMaximizer  = document.getElementById('htp-btn-maximizer');
    const oddsImpact    = document.getElementById('htp-odds-impact');
    const hedgeClaim    = document.getElementById('htp-hedge-claim');
    const hedgeReturn   = document.getElementById('hedge-return');
    const hedgeFee      = document.getElementById('hedge-fee');
    const progressWrap  = document.getElementById('htp-mx-progress-wrap');
    const progressText  = document.getElementById('htp-mx-progress-text');
    const progressFill  = document.getElementById('htp-mx-progress-fill');

    // Hide old toggle elements from original design
    const toggleRow     = document.getElementById('htp-mx-toggle-row');
    const toggle        = document.getElementById('htp-mx-toggle');
    const input     = document.getElementById('htp-mx-amount');
    const splitEl   = document.getElementById('htp-mx-split');
    const poolEl    = document.getElementById('htp-mx-pool');
    const hedgeEl   = document.getElementById('htp-mx-hedge');
    const capWrap   = document.getElementById('htp-mx-capwrap');
    const capText   = document.getElementById('htp-mx-cap-text');
    const capFill   = document.getElementById('htp-mx-capfill');
    const statusEl  = document.getElementById('htp-mx-status');
    const previewEl = document.getElementById('htp-mx-preview');
    const btn       = document.getElementById('htp-mx-btn');

    function update() {
      const bet = parseFloat(input.value) || 0;
      if (bet <= 0) {
        splitEl.style.display = 'none';
        capWrap.style.display = 'none';
        statusEl.style.display = 'none';
        previewEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Enter amount to continue';
        return;
      }

      if (!isMaximizer) {
        // Standard bet
        splitEl.style.display = 'none';
        hedgeClaim.style.display = 'none';
        capWrap.style.display = 'none';
        statusEl.style.display = 'none';
        progressWrap.style.display = 'none';
        
        // Show odds impact for standard
        const gross = bet * cfg.currentOdds;
        const fee   = (gross - bet) * 0.02;
        
        oddsImpact.style.display = 'flex';
        oddsImpact.className = 'htp-odds-impact live';
        oddsImpact.innerHTML = `
          <span>Live odds impact:</span>
          <span>${cfg.currentOdds.toFixed(2)}x multiplier</span>
        `;
        
        previewEl.style.display = 'block';
        previewEl.innerHTML = `
          <span class="win">WIN</span>: ${(gross - fee).toFixed(2)} KAS &nbsp;<span class="fee">(2% fee: ${fee.toFixed(2)} KAS)</span><br>
          <span class="lose">LOSE</span>: 0 KAS
        `;
        btn.disabled = false;
        btn.textContent = `Place ${bet} KAS Standard Bet`;
        return;
      }

      // Maximizer
      const Fee = W.HTPFee;
      if (!Fee) { btn.textContent = 'HTPFee not loaded'; btn.disabled = true; return; }

      const split  = Fee.maximizerSplit(bet);
      const check  = Fee.checkMaximizerAllowance({
        maxMaximizerPct:        cfg.maxMaximizerPct,
        expectedVolume:         cfg.expectedVolume,
        currentVolume:          cfg.currentVolume,
        currentMaximizerTotal:  cfg.currentMaximizerTotal,
      }, bet);

      // Maximizer
      splitEl.style.display = 'grid';
      capWrap.style.display = 'block';
      statusEl.style.display = 'block';
      hedgeClaim.style.display = 'block';
      progressWrap.style.display = 'block';

      // Odds impact indicator (live)
      oddsImpact.style.display = 'flex';
      oddsImpact.className = 'htp-odds-impact live';
      oddsImpact.innerHTML = `
        <span>Maximizer odds impact:</span>
        <span>${((cfg.currentOdds - 1) * 50).toFixed(1)}% improved payout</span>
      `;

      // Show pool split details (50/50)
      poolEl.textContent  = split.poolContribution.toFixed(2) + ' KAS';
      hedgeEl.textContent = split.hedgeAmount.toFixed(2) + ' KAS';

      // Show hedge claim preview information
      const hedgeReturnAmount = (split.hedgeAmount * 0.7).toFixed(2);
      const hedgeFeeAmount    = (split.hedgeAmount * 0.3).toFixed(2);
      hedgeReturn.textContent = hedgeReturnAmount;
      hedgeFee.textContent    = hedgeFeeAmount;

      // Cap bar
      capWrap.style.display = 'block';
      const cap  = check.cap || 0;
      const used = (check.used || 0) + (check.allowed ? split.poolContribution : 0);
      const pct  = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
      capText.textContent = `${(check.used||0).toFixed(0)} / ${cap.toFixed(0)} KAS`;
      capFill.style.width = pct + '%';
      capFill.className = 'htp-cap-bar-fill' + (pct >= 100 ? ' over' : '');

      // Status
      statusEl.style.display = 'block';
      if (check.allowed) {
        statusEl.className = 'htp-maximizer-status ok';
        statusEl.textContent = '✓ ' + check.reason;
      } else {
        statusEl.className = 'htp-maximizer-status blocked';
        statusEl.textContent = '✗ ' + check.reason;
      }

      // Payout preview
      const winCalc  = Fee.maximizerWinSettle(bet, cfg.currentOdds);
      const loseCalc = Fee.maximizerLoseSettle(bet);
      previewEl.style.display = 'block';
      previewEl.innerHTML = `
        <span class="win">WIN</span>: ${winCalc.netPayout.toFixed(2)} KAS &nbsp;<span class="fee">(2% fee on winnings: ${winCalc.protocolFee.toFixed(2)} KAS)</span><br>
        <span class="lose">LOSE</span>: claim <strong style="color:#f59e0b">${loseCalc.claimable.toFixed(2)} KAS</strong> hedge back &nbsp;<span class="fee">(30% fee: ${loseCalc.protocolFee.toFixed(2)} KAS)</span>
      `;

      btn.textContent = check.allowed
        ? `Place ${bet} KAS Maximizer Bet`
        : 'Maximizer Cap Reached';

      // Update progress bar for creator events (used/cap)
      if (check.used !== undefined && check.cap !== undefined) {
        if (check.cap > 0) {
          const pctUsed = Math.min(100, (check.used / check.cap) * 100);
          progressText.textContent = `${check.used.toFixed(0)} / ${check.cap.toFixed(0)} KAS`;
          progressFill.style.width = pctUsed + '%';
        } else {
          progressText.textContent = '— / —';
          progressFill.style.width = '0%';
        }
      } else {
        progressWrap.style.display = 'none';
      }

      btn.disabled = !check.allowed;
    }

    function setMode(mode) {
      isMaximizer = mode === 'maximizer';
      btnStandard.classList.toggle('active', !isMaximizer);
      btnMaximizer.classList.toggle('active', isMaximizer);
      update();
    }

    btnStandard.addEventListener('click', function() { setMode('standard'); });
    btnMaximizer.addEventListener('click', function() { setMode('maximizer'); });
    input.addEventListener('input', update);

    btn.addEventListener('click', function() {
      const bet = parseFloat(input.value) || 0;
      if (bet <= 0) return;
      window.dispatchEvent(new CustomEvent('htp:bet:submit', {
        detail: {
          eventId:     cfg.eventId,
          betKas:      bet,
          isMaximizer: isMaximizer,
          split:       isMaximizer ? W.HTPFee.maximizerSplit(bet) : null,
        }
      }));
    });

    return { update, getAmount: () => parseFloat(input.value)||0, isMaximizer: () => isMaximizer };
  }

  W.HTPMaximizerUI = { render, addMaximizerBadge };
  console.log('[HTPMaximizerUI] loaded');
})(window);
