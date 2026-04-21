/**
 * htp-settlement-preview.js
 * Pre-TX confirmation modal: shows winner, fee, treasury before any TX fires.
 * Intercepts settleMatchPayout and settleSkillMatch — wraps them with preview gate.
 * Also handles result modal after settlement with clickable TX hash.
 * Depends on: htp-fee-engine.js, htp-covenant-escrow-v2.js, htp-settlement-overlay.js
 */
(function(W) {
  'use strict';

  let _originalSettle = null;
  let _originalSkill  = null;

  /**
   * Install the preview gate.
   * Wraps W.settleMatchPayout so every settlement shows a preview first.
   */
  function install() {
    if (!W.settleMatchPayout) {
      console.warn('[HTPSettlementPreview] settleMatchPayout not found — will retry on htp:wallet:connected');
      window.addEventListener('htp:wallet:connected', install, { once: true });
      return;
    }
    if (W._htpPreviewInstalled) return;
    W._htpPreviewInstalled = true;

    _originalSettle = W.settleMatchPayout;
    _originalSkill  = W.settleSkillMatch;

    W.settleMatchPayout = async function(matchId, winnerAddr, isDraw, pA, pB) {
      // Get escrow to know the stake
      const esc = W.getEscrow ? W.getEscrow(matchId) : null;
      let stakeKas = 0;

      if (esc) {
        try {
          // Try to read balance from escrow address
          const res = await fetch((W.activeNet === 'mainnet'
            ? 'https://api.kaspa.org'
            : 'https://api-tn12.kaspa.org') + '/addresses/' + esc.address + '/balance');
          if (res.ok) {
            const data = await res.json();
            stakeKas = (parseFloat(data.balance || 0) / 1e8) / 2;
          }
        } catch(e) {}
      }

      return new Promise((resolve) => {
        if (!W.HTPSettlementOverlay) {
          // No overlay — fire immediately
          _originalSettle(matchId, winnerAddr, isDraw, pA, pB).then(resolve);
          return;
        }

        W.HTPSettlementOverlay.show({
          type:      'preview',
          matchId,
          stakeKas:  stakeKas || 0,
          winner:    winnerAddr,
          playerA:   pA,
          playerB:   pB,
          onConfirm: () => _originalSettle(matchId, winnerAddr, isDraw, pA, pB).then(resolve),
          onCancel:  () => resolve(null),
        });
      });
    };

    W.settleSkillMatch = function(matchId, winnerAddr) {
      return W.settleMatchPayout(matchId, winnerAddr, false, null, null);
    };

    console.log('[HTPSettlementPreview] Preview gate installed on settleMatchPayout');
  }

  /**
   * Show a result overlay after settlement completes.
   * Listens for htp:settlement:complete and displays win/lose/draw overlay.
   * Shows winner, pot, fee, net payout, and TX hash with clickable link.
   */
  function listenForResults() {
    window.addEventListener('htp:settlement:complete', function(e) {
      const { matchId, txId, winner, isDraw, stakeKas, isMaximizer, betKas, odds, feeKas, totalPot } = e.detail || {};
      
      // Calculate values if not provided
      const totalPotKas = totalPot || (stakeKas ? stakeKas * 2 : 0);
      const feeKasCalculated = feeKas || (totalPotKas ? totalPotKas * 0.025 : 0); // 2.5% platform fee
      const netPayout = totalPotKas - feeKasCalculated;
      
      // Show enhanced result modal instead of just overlay
      showResultModal({
        matchId,
        txId,
        winner,
        isDraw,
        stakeKas,
        isMaximizer,
        betKas,
        odds,
        totalPot: totalPotKas,
        fee: feeKasCalculated,
        netPayout
      });
      
      if (!W.HTPSettlementOverlay) return;

      const myAddress = W.walletAddress || W.htpAddress || W.connectedAddress;
      let type = 'win';
      if (isDraw) type = 'draw';
      else if (winner && myAddress && winner !== myAddress) type = 'lose';

      W.HTPSettlementOverlay.show({
        type,
        matchId,
        txId,
        stakeKas:    stakeKas || 0,
        winner,
        isMaximizer: isMaximizer || false,
        betKas:      betKas || stakeKas,
        odds:        odds || 2,
      });
    });
  }

  /**
   * Show enhanced result modal with settlement details
   * Displays winner, pot, fee, net payout, and clickable TX hash
   */
  function showResultModal(data) {
    const { matchId, txId, winner, isDraw, totalPot, fee, netPayout, stakeKas } = data;
    
    const myAddress = W.walletAddress || W.htpAddress || W.connectedAddress;
    const isWinner = winner && myAddress && winner === myAddress;
    const isParticipant = stakeKas && stakeKas > 0;
    
    // Create modal container
    const modalId = 'htp-settlement-result-modal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();
    
    modal = document.createElement('div');
    modal.id = modalId;
    modal.innerHTML = `
      <div class="htp-result-backdrop" onclick="closeSettlementResult()">
        <div class="htp-result-card" onclick="event.stopPropagation()">
          <div class="htp-result-header ${isDraw ? 'draw' : isWinner ? 'win' : 'lose'}">
            <h2>${isDraw ? '🤝 Draw!' : isWinner ? '🎉 You Won!' : '😔 You Lost'}</h2>
          </div>
          <div class="htp-result-body">
            <div class="htp-result-row">
              <span>Total Pot</span>
              <span class="htp-result-value">${(totalPot || 0).toFixed(6)} KAS</span>
            </div>
            <div class="htp-result-row">
              <span>Platform Fee (2.5%)</span>
              <span class="htp-result-value">-${(fee || 0).toFixed(6)} KAS</span>
            </div>
            <div class="htp-result-row htp-result-total">
              <span>Net Payout</span>
              <span class="htp-result-value htp-result-net">${(isWinner || isDraw ? (netPayout || 0) : 0).toFixed(6)} KAS</span>
            </div>
            <div class="htp-result-row">
              <span>Winner</span>
              <span class="htp-result-value htp-result-winner">${winner ? truncateWallet(winner) : 'None'}</span>
            </div>
            <div class="htp-result-row">
              <span>Match ID</span>
              <span class="htp-result-value htp-result-muted">${matchId || '-'}</span>
            </div>
            <div class="htp-result-row htp-result-tx">
              <span>Transaction</span>
              <span class="htp-result-value">
                ${txId ? makeTxLink(txId) : 'Pending...'}
              </span>
            </div>
          </div>
          <div class="htp-result-actions">
            <button class="htp-result-btn" onclick="closeSettlementResult()">Close</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add styles if not present
    addResultModalStyles();
  }

  function truncateWallet(addr) {
    if (!addr) return 'Unknown';
    return addr.substring(0, 6) + '...' + addr.substring(addr.length - 4);
  }

  function makeTxLink(txid) {
    const network = W.activeNet === 'mainnet' ? '' : 'tn12.';
    return `<a href="https://${network}kaspa.stream/txs/${txid}" 
      target="_blank" 
      rel="noopener noreferrer" 
      class="htp-tx-link"
      >${txid.substring(0, 8)}...${txid.substring(txid.length - 8)} ↗</a>`;
  }

  function addResultModalStyles() {
    if (document.getElementById('htp-result-modal-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'htp-result-modal-styles';
    style.textContent = `
      .htp-result-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.85);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        animation: htpFadeIn 0.2s ease;
      }
      .htp-result-card {
        background: rgba(6,10,22,0.95);
        border: 1px solid rgba(148,163,184,0.15);
        border-radius: 16px;
        max-width: 420px;
        width: 90%;
        box-shadow: 0 0 40px rgba(73,232,194,0.15);
        animation: htpSlideUp 0.3s ease;
      }
      .htp-result-header {
        padding: 24px;
        text-align: center;
        border-bottom: 1px solid rgba(148,163,184,0.1);
        border-radius: 16px 16px 0 0;
      }
      .htp-result-header.win { background: linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.05)); }
      .htp-result-header.lose { background: linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.05)); }
      .htp-result-header.draw { background: linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.05)); }
      .htp-result-header h2 { margin: 0; font-size: 1.5rem; color: #f1f5f9; }
      .htp-result-body { padding: 20px 24px; }
      .htp-result-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid rgba(148,163,184,0.08);
      }
      .htp-result-row:last-child { border-bottom: none; }
      .htp-result-row span:first-child { color: #7a8899; font-size: 0.9rem; }
      .htp-result-value { color: #f1f5f9; font-weight: 500; font-family: 'JetBrains Mono', monospace; }
      .htp-result-total { border-top: 2px solid rgba(73,232,194,0.2); margin-top: 8px; padding-top: 16px; }
      .htp-result-net { color: #49e8c2; font-size: 1.1rem; font-weight: 600; }
      .htp-result-winner { color: #7c6ff7; }
      .htp-result-muted { color: #7a8899; font-size: 0.8rem; }
      .htp-result-tx .htp-tx-link {
        color: #49e8c2;
        text-decoration: none;
        font-size: 0.85rem;
        transition: color 0.2s;
      }
      .htp-result-tx .htx-tx-link:hover {
        color: #7c6ff7;
        text-decoration: underline;
      }
      .htp-result-actions {
        padding: 16px 24px 24px;
        display: flex;
        justify-content: center;
      }
      .htp-result-btn {
        background: linear-gradient(135deg, #49e8c2, #7c6ff7);
        border: none;
        color: #010806;
        padding: 12px 32px;
        border-radius: 8px;
        font-weight: 600;
      }
      .htp-result-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 20px rgba(73,232,194,0.3);
      }
      @keyframes htpFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes htpSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
  }

  // Global close function
  W.closeSettlementResult = function() {
    const modal = document.getElementById('htp-settlement-result-modal');
    if (modal) {
      modal.style.opacity = '0';
      setTimeout(() => modal.remove(), 200);
    }
  };
  
  // Helper to determine result type
  W.getResultType = function(data) {
    const myAddress = W.walletAddress || W.htpAddress || W.connectedAddress;
    let type = 'win';
    if (data.isDraw) type = 'draw';
    else if (data.winner && myAddress && data.winner !== myAddress) type = 'lose';
    return type;
  };

  // Auto-install
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { install(); listenForResults(); });
  } else {
    install();
    listenForResults();
  }

  W.HTPSettlementPreview = { install, listenForResults };
  console.log('[HTPSettlementPreview] loaded');
})(window);
