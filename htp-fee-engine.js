/**
 * htp-fee-engine.js v2.1 — HTP Protocol Fee & Maximizer Engine
 *
 * FEE RULES:
 *   Skill games (1v1, winner-takes-all):
 *     - Winner pays 2% protocol fee on total pool
 *     - Creator can cancel anytime before opponent joins (full refund)
 *     - Creator who leaves after game starts = forfeit (counted as loss, no refund)
 *
 *   Events (parimutuel pools):
 *     - Standard bet: full amount goes to pool
 *     - Maximizer bet: 50% to pool, 50% hedged
 *       WIN:  payout as if 100% was in pool × odds, then 2% fee on winnings
 *       LOSE: can claim 50% hedge back, but pays 30% of hedge as protocol fee
 *              → net hedge recovery = 50% × 0.70 = 35% of original bet
 *     - Maximizers are parasitic (lower odds for everyone) — event creators can
 *       limit them via maxMaximizerPct + expectedVolume
 *
 * TREASURY:
 *   mainnet:    kaspa:qza6ah0lfqf33c9m00ynkfeettuleluvnpyvmssm5pzz7llwy2ka5nkka4fel
 *   testnet-12: kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m
 *
 * LOAD ORDER: after htp-init.js (reads window.HTP_NETWORK)
 *             before htp-covenant-escrow-v2.js, htp-events-v3.js
 */

(function (W) {
  'use strict';

  // ── Treasury addresses (canonical, one place) ──────────────────────────
  var TREASURY = {
    'mainnet':    'kaspa:qza6ah0lfqf33c9m00ynkfeettuleluvnpyvmssm5pzz7llwy2ka5nkka4fel',
    'tn12':       'kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m',
    'testnet-12': 'kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m',
  };

  // ── Fee constants (change here, nowhere else) ──────────────────────────
  var FEES = {
    SKILL_GAME_WIN_PCT:          0.02,   // 2% on total pool, paid by winner
    EVENT_WIN_PCT:               0.02,   // 2% on winnings for maximizer/standard wins
    MAXIMIZER_HEDGE_LOSS_PCT:    0.30,   // 30% of hedge taken if maximizer loses
    MAXIMIZER_POOL_CONTRIBUTION: 0.50,   // 50% of bet goes to pool, 50% hedged
  };

  // ── Network helper ─────────────────────────────────────────────────────
  // Reads window.HTP_NETWORK set by htp-init.js.
  // Default: 'tn12' (matches htp-init.js default — NOT mainnet).
  function networkKey() {
    return W.HTP_NETWORK || 'tn12';
  }

  function treasuryAddress() {
    return TREASURY[networkKey()] || TREASURY['tn12'];
  }

  // ── Sompi helpers (used by escrow + oracle) ────────────────────────────
  var SOMPI_PER_KAS = 100000000;
  function kasToSompi(kas)  { return BigInt(Math.round(kas  * SOMPI_PER_KAS)); }
  function sompiToKas(sompi){ return Number(sompi) / SOMPI_PER_KAS; }

  // ══════════════════════════════════════════════════════════════════════
  // SKILL GAMES
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Calculate skill game settlement amounts.
   * @param {number} stakeKas — stake per player (each player puts in this amount)
   * @returns {{ totalPool, protocolFee, winnerPayout, protocolFeeSompi,
   *             winnerPayoutSompi, treasuryAddress, feeBreakdown }}
   */
  function skillGameSettle(stakeKas) {
    var totalPool    = stakeKas * 2;
    var protocolFee  = totalPool * FEES.SKILL_GAME_WIN_PCT;
    var winnerPayout = totalPool - protocolFee;
    return {
      totalPool:          totalPool,
      protocolFee:        protocolFee,
      winnerPayout:       winnerPayout,
      // Sompi versions for on-chain use
      protocolFeeSompi:   kasToSompi(protocolFee),
      winnerPayoutSompi:  kasToSompi(winnerPayout),
      feeBreakdown:       '2% of ' + totalPool.toFixed(4) + ' KAS pool',
      treasuryAddress:    treasuryAddress(),
    };
  }

  /**
   * Can the skill game creator cancel?
   * @param {object} game — { status, joinerId, opponentJoined }
   */
  function skillGameCanCreatorCancel(game) {
    var started = game.opponentJoined
               || (game.joinerId && game.joinerId !== '')
               || (game.status && game.status !== 'waiting' && game.status !== 'open');
    if (started) {
      return { allowed: false, reason: 'Game already started — leaving counts as forfeit' };
    }
    return { allowed: true, reason: 'No opponent yet — full refund available' };
  }

  // ══════════════════════════════════════════════════════════════════════
  // MAXIMIZER LOGIC
  // ══════════════════════════════════════════════════════════════════════

  function maximizerSplit(betKas) {
    var pool = betKas * FEES.MAXIMIZER_POOL_CONTRIBUTION;
    return { poolContribution: pool, hedgeAmount: pool, effectivePoolBet: pool };
  }

  function maximizerWinSettle(betKas, odds) {
    var grossPayout = betKas * odds;
    var netWinnings = grossPayout - betKas;
    var protocolFee = netWinnings * FEES.EVENT_WIN_PCT;
    var netPayout   = grossPayout - protocolFee;
    var hedge       = maximizerSplit(betKas).hedgeAmount;
    return {
      grossPayout:     grossPayout,
      protocolFee:     protocolFee,
      netPayout:       netPayout,
      hedgeReturned:   hedge,
      feeBreakdown:    '2% of ' + netWinnings.toFixed(4) + ' KAS winnings',
      treasuryAddress: treasuryAddress(),
    };
  }

  function maximizerLoseSettle(betKas) {
    var hedge       = maximizerSplit(betKas).hedgeAmount;
    var protocolFee = hedge * FEES.MAXIMIZER_HEDGE_LOSS_PCT;
    var claimable   = hedge - protocolFee;
    return {
      hedgeAmount:     hedge,
      protocolFee:     protocolFee,
      claimable:       claimable,
      poolLoss:        betKas * FEES.MAXIMIZER_POOL_CONTRIBUTION,
      feeBreakdown:    '30% of ' + hedge.toFixed(4) + ' KAS hedge',
      treasuryAddress: treasuryAddress(),
    };
  }

  function checkMaximizerAllowance(event, newBetKas) {
    var maxPct   = event.maxMaximizerPct      || 0;
    var expVol   = event.expectedVolume       || 0;
    var curVol   = event.currentVolume        || 0;
    var curMaxi  = event.currentMaximizerTotal || 0;

    if (maxPct === 0) return { allowed: false, reason: 'Event creator disabled maximizers' };

    var refVol = Math.max(expVol, curVol);
    var cap    = refVol * maxPct;
    var contrib = maximizerSplit(newBetKas).poolContribution;
    var avail  = Math.max(0, cap - curMaxi);

    if (contrib > avail) {
      return {
        allowed:   false,
        cap:       cap,
        used:      curMaxi,
        available: avail,
        reason:    'Maximizer cap reached: ' + curMaxi.toFixed(2) + '/' + cap.toFixed(2) + ' KAS used',
      };
    }
    return {
      allowed:   true,
      cap:       cap,
      used:      curMaxi,
      available: avail,
      newUsed:   curMaxi + contrib,
      reason:    'OK — ' + avail.toFixed(2) + ' KAS maximizer capacity remaining',
    };
  }

  function maximizerCapRemaining(event) {
    var maxPct  = event.maxMaximizerPct      || 0;
    var expVol  = event.expectedVolume       || 0;
    var curVol  = event.currentVolume        || 0;
    var curMaxi = event.currentMaximizerTotal || 0;
    return Math.max(0, Math.max(expVol, curVol) * maxPct - curMaxi);
  }

  // ══════════════════════════════════════════════════════════════════════
  // STANDARD EVENT BET
  // ══════════════════════════════════════════════════════════════════════

  function standardEventWinSettle(betKas, odds) {
    var gross      = betKas * odds;
    var winnings   = gross - betKas;
    var fee        = winnings * FEES.EVENT_WIN_PCT;
    var net        = gross - fee;
    return {
      grossPayout:     gross,
      protocolFee:     fee,
      netPayout:       net,
      feeBreakdown:    '2% of ' + winnings.toFixed(4) + ' KAS winnings',
      treasuryAddress: treasuryAddress(),
    };
  }

  // ── Generic summarize ─────────────────────────────────────────────────
  function summarize(type, params) {
    switch (type) {
      case 'skill_win':      return skillGameSettle(params.stakeKas);
      case 'maximizer_win':  return maximizerWinSettle(params.betKas, params.odds);
      case 'maximizer_lose': return maximizerLoseSettle(params.betKas);
      case 'standard_win':   return standardEventWinSettle(params.betKas, params.odds);
      default: throw new Error('Unknown fee type: ' + type);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────
  W.HTPFee = {
    FEES:             FEES,
    TREASURY:         TREASURY,
    treasuryAddress:  treasuryAddress,
    networkKey:       networkKey,

    // Sompi converters (used by escrow + oracle)
    kasToSompi:       kasToSompi,
    sompiToKas:       sompiToKas,

    // Skill games
    skillGameSettle:          skillGameSettle,
    skillGameCanCreatorCancel: skillGameCanCreatorCancel,

    // Events — maximizer
    maximizerSplit:            maximizerSplit,
    maximizerWinSettle:        maximizerWinSettle,
    maximizerLoseSettle:       maximizerLoseSettle,
    checkMaximizerAllowance:   checkMaximizerAllowance,
    maximizerCapRemaining:     maximizerCapRemaining,

    // Events — standard
    standardEventWinSettle:    standardEventWinSettle,

    // Generic
    summarize: summarize,
  };

  console.log('[HTPFee] v2.1 loaded | net:', networkKey(), '| treasury:', treasuryAddress());

})(window);
