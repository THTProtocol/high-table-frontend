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
