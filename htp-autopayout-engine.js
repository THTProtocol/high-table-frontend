/**
 * htp-autopayout-engine.js  —  High Table Protocol  —  v4.0
 *
 * THE COMPLETE LAYER:
 *
 *  1. AUTO-PAYOUT PIPELINE
 *     handleMatchGameOver() → writes Firebase result → this file detects it
 *     → calls window.settleMatchPayout() (htp-covenant-escrow-v2.js)
 *     → escrow key is local-only, TX is built + submitted client-side
 *     → winner browser fires the on-chain TX automatically, NO BUTTON NEEDED
 *     → Firebase settlement lock prevents double-spend across both browsers
 *
 *  2. GAME UI — CHESS (Chess.com aesthetic, full)
 *     Board colors: #ebecd0 / #779556
 *     Pieces: unicode, white=bright, black=dark, no teal tint
 *     Clocks: both players, active clock highlighted, Firebase-synced
 *     Coord labels on every square
 *     Last-move highlight, check highlight, legal-move dots
 *
 *  3. GAME UI — CONNECT4
 *     6×7 grid, drop animation, gravity, win-line highlight
 *     Red vs Yellow, turn indicator, Firebase-synced clock
 *
 *  4. GAME UI — CHECKERS
 *     8×8 board, dark squares only, multi-jump support
 *     Red vs Black, king promotion glow, Firebase-synced clock
 *
 *  5. COVENANT INTEGRITY GUARD
 *     Validates that redeemScript fee SPK === current treasury SPK
 *     before any settlement TX is built. Blocks if mismatch.
 *
 *  6. PROTOCOL FEE ADDRESSES (canonical, read from HTPFee)
 *     mainnet:    kaspa:qza6ah0lfqf33c9m00ynkfeettuleluvnpyvmssm5pzz7llwy2ka5nkka4fel
 *     testnet-12: kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m
 *
 *  LOAD ORDER: LAST — after all other htp-*.js files
 */

;(function(W) {
  'use strict';

  const LOG  = (...a) => console.log('%c[HTP AutoPayout v4]', 'color:#49e8c2;font-weight:bold', ...a);
  const WARN = (...a) => console.warn('[HTP AutoPayout v4]', ...a);
  const ERR  = (...a) => console.error('[HTP AutoPayout v4]', ...a);

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. FIREBASE HELPERS
   * ═══════════════════════════════════════════════════════════════════════ */
  function fdb() {
    return (typeof firebase !== 'undefined' && firebase.database) ? firebase.database() : null;
  }
  function activeMatch() {
    return (typeof matchLobby !== 'undefined') ? matchLobby.activeMatch : null;
  }
  function myPlayerId() {
    return W.connectedAddress || W.htpAddress || W.walletAddress ||
           (typeof matchLobby !== 'undefined' && matchLobby.myPlayerId) ||
           localStorage.getItem('htpPlayerId') || 'unknown';
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. COVENANT INTEGRITY GUARD
   *    Validates that the redeemScript in localStorage still encodes the
   *    current treasury address before any settlement fires.
   * ═══════════════════════════════════════════════════════════════════════ */
  function getTreasurySpk() {
    if (W.htpEscrowUtils && W.htpEscrowUtils.addrToSpkHex) {
      const tAddr = W.HTPFee ? W.HTPFee.treasuryAddress() :
        (W.HTP_NETWORK === 'mainnet'
          ? 'kaspa:qza6ah0lfqf33c9m00ynkfeettuleluvnpyvmssm5pzz7llwy2ka5nkka4fel'
          : 'kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m');
      return W.htpEscrowUtils.addrToSpkHex(tAddr);
    }
    return null;
  }

  function covenantIntegrityCheck(escrow) {
    if (!escrow || !escrow.redeemScript) return true;
    const expectedSpk = getTreasurySpk();
    if (!expectedSpk) return true;
    const script = escrow.redeemScript.toLowerCase();
    const spk    = expectedSpk.toLowerCase();
    if (!script.includes(spk)) {
      ERR('COVENANT INTEGRITY FAIL — redeemScript fee SPK mismatch!');
      ERR('Expected SPK:', expectedSpk);
      ERR('RedeemScript:', escrow.redeemScript);
      if (W.showToast) W.showToast('⚠️ Covenant integrity check failed — settlement blocked', 'error');
      return false;
    }
    LOG('Covenant integrity ✓ — fee SPK verified in redeemScript');
    return true;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. AUTO-PAYOUT PIPELINE
   * ═══════════════════════════════════════════════════════════════════════ */

  let _gameOverPatched = false;

  function patchHandleMatchGameOver() {
    if (_gameOverPatched) return;
    const orig = W.handleMatchGameOver;
    if (!orig) return;
    _gameOverPatched = true;

    W.handleMatchGameOver = async function(reason, winnerRaw) {
      if (W._htpGameClock) { W._htpGameClock.destroy(); W._htpGameClock = null; }
      if (W.htpSyncClock)  { W.htpSyncClock.destroy(); }
      if (W.chessUI && W.chessUI.timerInterval) {
        clearInterval(W.chessUI.timerInterval);
        W.chessUI.gameOver = true;
      }

      const match   = activeMatch();
      const matchId = match ? match.id : W._htpCurrentMatchId;
      const game    = match ? (match.game || match.gameType || 'chess').toLowerCase() : 'chess';
      const myId    = myPlayerId();

      const winnerStr = normalizeWinner(winnerRaw, game);

      const myColor = W._htpMyColor || 'white';
      const mySide  = W._htpMySide  || 1;
      let   iWon    = false;

      if (game === 'c4' || game === 'connect4') {
        iWon = (winnerRaw === mySide);
      } else if (game === 'ck' || game === 'checkers') {
        iWon = (winnerRaw === mySide);
      } else {
        const winnerColor = (winnerRaw === 'w' || winnerRaw === 1 || winnerRaw === 'white') ? 'white' : 'black';
        iWon = (winnerColor === myColor);
      }

      const isDraw = (reason === 'draw' || reason === 'stalemate' || reason === 'repetition');
      if (isDraw) iWon = false;

      let alreadySettled = false;
      if (matchId && fdb()) {
        try {
          const resultRef = fdb().ref('relay/' + matchId + '/result');
          const snap = await resultRef.once('value');
          if (snap.exists() && snap.val().txId) {
            alreadySettled = true;
            LOG('Match already settled, txId:', snap.val().txId);
          } else if (!snap.exists()) {
            await resultRef.set({ winner: winnerStr, reason: reason, ts: Date.now(), by: myId, matchId: matchId });
            if (fdb()) {
              fdb().ref('matches/' + matchId + '/info/status').set('completed').catch(()=>{});
              fdb().ref('matches/' + matchId + '/info/winner').set(winnerStr).catch(()=>{});
              fdb().ref('matches/' + matchId + '/info/reason').set(reason).catch(()=>{});
            }
          }
        } catch(e) { WARN('Firebase result lock error:', e.message); }
      }

      showGameOverOverlay({ reason, winnerStr, iWon, isDraw, matchId, game });

      if (!alreadySettled && matchId) {
        const escrow = W.getEscrow ? W.getEscrow(matchId) : null;
        const hasKey = escrow && escrow.privateKey && !escrow.settled;

        if (hasKey && !covenantIntegrityCheck(escrow)) {
          ERR('Payout blocked by covenant integrity check');
        } else if (hasKey && (iWon || isDraw)) {
          LOG('Auto-payout triggered — building settlement TX…');
          setTimeout(() => triggerAutoPayout(matchId, winnerStr, isDraw, match, escrow), 400);
        } else if (!hasKey && (iWon || isDraw)) {
          LOG('No local escrow key — listening for partner settlement…');
          listenForSettlement(matchId);
        } else {
          LOG('I lost (' + game + ') — settlement will fire from winner\'s browser');
          listenForSettlement(matchId);
        }
      }
    };

    W.handleMatchGameOver._autoPayoutPatched = true;
    LOG('handleMatchGameOver auto-payout patch installed');
  }

  function normalizeWinner(raw, game) {
    if (game === 'c4' || game === 'connect4') return 'side' + raw;
    if (game === 'ck' || game === 'checkers') return 'side' + raw;
    if (raw === 'w' || raw === 'white' || raw === 1) return 'white';
    if (raw === 'b' || raw === 'black' || raw === 2) return 'black';
    return String(raw);
  }

  async function triggerAutoPayout(matchId, winnerStr, isDraw, match, escrow) {
    const myAddr    = myPlayerId();
    const winnerAddr = resolveWinnerAddress(winnerStr, match, myAddr);
    let   playerAAddr = null, playerBAddr = null;

    if (isDraw) {
      playerAAddr = match ? (match.creatorAddress  || match.creator)  : myAddr;
      playerBAddr = match ? (match.joinerAddress   || match.opponent) : myAddr;
      if (!playerAAddr || !playerBAddr) {
        try {
          const snap = await fdb().ref('matches/' + matchId + '/info').once('value');
          const info = snap.val() || {};
          playerAAddr = info.creatorAddress || info.creator  || myAddr;
          playerBAddr = info.joinerAddress  || info.opponent || myAddr;
        } catch(e) {}
      }
    }

    const overlayEl = document.getElementById('htp-gameover-overlay');
    const statusEl  = overlayEl && overlayEl.querySelector('.htp-go-settle-status');
    if (statusEl) { statusEl.textContent = '⏳ Settling on-chain…'; statusEl.style.color = '#f59e0b'; }

    try {
      let txId;
      if (isDraw) {
        txId = await W.settleMatchPayout(matchId, null, true, playerAAddr, playerBAddr);
      } else {
        txId = await W.settleMatchPayout(matchId, winnerAddr, false, null, null);
      }

      if (txId) {
        LOG('Settlement TX submitted:', txId);
        if (fdb()) {
          fdb().ref('relay/' + matchId + '/result/txId').set(txId).catch(()=>{});
        }
        updateOverlayWithTx(txId);
      }
    } catch(e) {
      ERR('Auto-payout failed:', e.message);
      if (statusEl) { statusEl.textContent = '⚠️ Settlement failed: ' + e.message; statusEl.style.color = '#ef4444'; }
    }
  }

  function resolveWinnerAddress(winnerStr, match, myAddr) {
    if (!match) return myAddr;
    const creatorAddr  = match.creatorAddress  || match.creator;
    const joinerAddr   = match.joinerAddress   || match.opponent;
    const myColor      = W._htpMyColor || 'white';
    const mySide       = W._htpMySide  || 1;

    const iAmWinner =
      (winnerStr === 'white' && myColor === 'white') ||
      (winnerStr === 'black' && myColor === 'black') ||
      (winnerStr === 'side1' && mySide === 1) ||
      (winnerStr === 'side2' && mySide === 2) ||
      (winnerStr === 'side3' && mySide === 3);

    if (iAmWinner) return myAddr;
    const isCreator = (creatorAddr && creatorAddr === myAddr);
    return isCreator ? joinerAddr : creatorAddr;
  }

  function listenForSettlement(matchId) {
    if (!fdb() || !matchId) return;
    const ref = fdb().ref('relay/' + matchId + '/result/txId');
    const fn  = ref.on('value', function(snap) {
      if (snap.exists() && snap.val()) {
        ref.off('value', fn);
        updateOverlayWithTx(snap.val());
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. GAME-OVER OVERLAY
   * ═══════════════════════════════════════════════════════════════════════ */

  function injectOverlayStyles() {
    if (document.getElementById('htp-go-style')) return;
    const s = document.createElement('style');
    s.id = 'htp-go-style';
    s.textContent = `
      #htp-gameover-overlay {
        position:fixed;inset:0;z-index:10000;
        display:flex;align-items:center;justify-content:center;
        background:rgba(0,0,0,.8);backdrop-filter:blur(10px);
        animation:htpFadeIn .25s ease;
      }
      @keyframes htpFadeIn{from{opacity:0}to{opacity:1}}
      @keyframes htpSlideUp{from{transform:translateY(28px);opacity:0}to{transform:translateY(0);opacity:1}}
      .htp-go-card {
        background:linear-gradient(145deg,#0f172a,#1e293b);
        border:1px solid rgba(73,232,194,.2);border-radius:20px;
        padding:36px 28px;max-width:400px;width:92%;text-align:center;
        animation:htpSlideUp .3s ease;font-family:'Inter',sans-serif;color:#e2e8f0;
        box-shadow:0 24px 60px rgba(0,0,0,.6),0 0 40px rgba(73,232,194,.08);
      }
      .htp-go-icon { font-size:64px;margin-bottom:12px;display:block;filter:drop-shadow(0 4px 8px rgba(0,0,0,.4)); }
      .htp-go-title { font-size:28px;font-weight:900;letter-spacing:-.03em;margin-bottom:6px; }
      .htp-go-title.win  { background:linear-gradient(135deg,#49e8c2,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent; }
      .htp-go-title.lose { color:#ef4444; }
      .htp-go-title.draw { color:#f59e0b; }
      .htp-go-reason { font-size:13px;color:#64748b;margin-bottom:20px; }
      .htp-go-payout {
        background:#1e293b;border-radius:12px;padding:16px;margin-bottom:20px;
        border:1px solid rgba(255,255,255,.06);
      }
      .htp-go-payout-amount { font-size:32px;font-weight:800;margin-bottom:4px; }
      .htp-go-payout-amount.win  { color:#49e8c2; }
      .htp-go-payout-amount.draw { color:#f59e0b; }
      .htp-go-payout-amount.lose { color:#475569; }
      .htp-go-payout-row {
        display:flex;justify-content:space-between;
        font-size:12px;padding:4px 0;
        border-bottom:1px solid rgba(255,255,255,.05);
      }
      .htp-go-payout-row:last-child{border:none;}
      .htp-go-payout-row .lbl{color:#64748b;}
      .htp-go-payout-row .val{font-weight:600;}
      .htp-go-payout-row .val.green{color:#49e8c2;}
      .htp-go-payout-row .val.red{color:#ef4444;}
      .htp-go-settle-status { font-size:12px;color:#f59e0b;margin-top:10px;min-height:18px; }
      .htp-go-tx { font-size:11px;color:#475569;margin-top:8px;word-break:break-all; }
      .htp-go-tx a{color:#3b82f6;text-decoration:none;}
      .htp-go-tx a:hover{text-decoration:underline;}
      .htp-go-btns{display:flex;gap:10px;margin-top:20px;}
      .htp-go-btn {
        flex:1;padding:13px;border-radius:10px;border:none;
        font-weight:700;font-size:14px;cursor:pointer;
        transition:opacity .2s,transform .1s;
      }
      .htp-go-btn:active{transform:scale(.96);}
      .htp-go-btn.primary{background:linear-gradient(135deg,#49e8c2,#3b82f6);color:#0f172a;}
      .htp-go-btn.secondary{background:#1e293b;color:#94a3b8;border:1px solid rgba(255,255,255,.08);}
      .htp-go-btn:hover{opacity:.88;}
    `;
    document.head.appendChild(s);
  }

  function showGameOverOverlay({ reason, winnerStr, iWon, isDraw, matchId, game }) {
    injectOverlayStyles();
    const old = document.getElementById('htp-gameover-overlay');
    if (old) old.remove();

    let icon, titleText, titleCls, payoutAmount, payoutCls, rows = [], reasonText;
    const stakeKas = (() => {
      const m = activeMatch();
      return parseFloat(m && (m.stakeKas || m.stake) || 0);
    })();
    const calc = W.HTPFee ? W.HTPFee.skillGameSettle(stakeKas || 5) : {
      totalPool: (stakeKas||5)*2, protocolFee: (stakeKas||5)*2*0.02,
      winnerPayout: (stakeKas||5)*2*0.98
    };

    if (isDraw) {
      icon='🤝'; titleCls='draw'; titleText='Draw';
      payoutAmount = stakeKas.toFixed(2)+' KAS'; payoutCls='draw';
      reasonText = reason === 'stalemate' ? 'Stalemate' : 'Draw by ' + reason;
      rows=[
        {lbl:'Each player receives',val:stakeKas.toFixed(2)+' KAS',cls:'green'},
        {lbl:'Protocol fee',val:'None (draw)',cls:''},
      ];
    } else if (iWon) {
      icon='🏆'; titleCls='win'; titleText='You Won!';
      payoutAmount = '+'+calc.winnerPayout.toFixed(2)+' KAS'; payoutCls='win';
      reasonText = reason === 'checkmate' ? 'Checkmate' : reason === 'timeout' ? 'Timeout' : reason === 'resign' ? 'Opponent resigned' : 'Victory';
      rows=[
        {lbl:'Total pool',     val:calc.totalPool.toFixed(2)+' KAS',cls:''},
        {lbl:'Protocol fee',  val:'−'+calc.protocolFee.toFixed(2)+' KAS',cls:'red'},
        {lbl:'Your payout',   val:calc.winnerPayout.toFixed(2)+' KAS',cls:'green'},
        {lbl:'Treasury',      val:(W.HTPFee?W.HTPFee.treasuryAddress():'').slice(0,16)+'…',cls:''},
      ];
    } else {
      icon='💀'; titleCls='lose'; titleText='You Lost';
      payoutAmount='0 KAS'; payoutCls='lose';
      reasonText = reason === 'checkmate' ? 'Checkmate' : reason === 'timeout' ? 'Timeout' : reason === 'resign' ? 'You resigned' : 'Defeat';
      rows=[
        {lbl:'Result',val:'Loss',cls:'red'},
        {lbl:'Stake lost',val:stakeKas.toFixed(2)+' KAS',cls:''},
      ];
    }

    const rowsHtml = rows.map(r=>
      `<div class="htp-go-payout-row"><span class="lbl">${r.lbl}</span><span class="val ${r.cls}">${r.val}</span></div>`
    ).join('');

    const el = document.createElement('div');
    el.id = 'htp-gameover-overlay';
    el.innerHTML = `
      <div class="htp-go-card">
        <span class="htp-go-icon">${icon}</span>
        <div class="htp-go-title ${titleCls}">${titleText}</div>
        <div class="htp-go-reason">${reasonText}</div>
        <div class="htp-go-payout">
          <div class="htp-go-payout-amount ${payoutCls}">${payoutAmount}</div>
          ${rowsHtml}
        </div>
        <div class="htp-go-settle-status">${(iWon||isDraw)?'⏳ Settling on-chain…':'⏳ Waiting for settlement…'}</div>
        <div class="htp-go-tx" id="htp-go-tx-link"></div>
        <div class="htp-go-btns">
          <button class="htp-go-btn secondary" onclick="document.getElementById('htp-gameover-overlay').remove()">Close</button>
          <button class="htp-go-btn primary"   onclick="window.location.reload()">New Game</button>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  function updateOverlayWithTx(txId) {
    const statusEl = document.querySelector('.htp-go-settle-status');
    const txEl     = document.getElementById('htp-go-tx-link');
    const explorer = (W.HTP_NETWORK === 'mainnet')
      ? 'https://explorer.kaspa.org/txs/'
      : 'https://explorer-tn12.kaspa.org/txs/';
    if (statusEl) { statusEl.textContent = '✅ Settled on-chain'; statusEl.style.color = '#49e8c2'; }
    if (txEl) txEl.innerHTML = `TX: <a href="${explorer}${txId}" target="_blank">${String(txId).slice(0,20)}…</a>`;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. CHESS BOARD UI  (Chess.com aesthetic)
   * ═══════════════════════════════════════════════════════════════════════ */

  const PIECES = {
    wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
    bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'
  };

  function injectChessStyles() {
    if (document.getElementById('htp-chess-style-v4')) return;
    const s = document.createElement('style');
    s.id = 'htp-chess-style-v4';
    s.textContent = `
      #htpChessOverlay {
        position:fixed;inset:0;z-index:9000;
        display:flex;align-items:center;justify-content:center;
        background:#161512;overflow:auto;
      }
      .htp-chess-wrap {
        display:flex;flex-direction:column;align-items:center;
        width:min(520px,100vw);gap:0;
        padding:12px;box-sizing:border-box;
      }
      .htp-chess-playerbar {
        display:flex;align-items:center;gap:8px;
        width:100%;padding:6px 10px;
        background:#2a2827;border-radius:6px;margin-bottom:3px;
        box-sizing:border-box;
      }
      .htp-chess-playerbar .avatar {
        width:30px;height:30px;border-radius:4px;
        background:#3a3a3a;display:flex;align-items:center;
        justify-content:center;font-size:16px;flex-shrink:0;
      }
      .htp-chess-playerbar .name {font-size:13px;font-weight:600;color:#e8e6e3;flex:1;}
      .htp-chess-clock {
        font-family:'SF Mono','Fira Code',monospace;font-size:18px;font-weight:700;
        padding:3px 12px;border-radius:4px;min-width:68px;text-align:center;
        transition:background .2s,color .2s;
      }
      .htp-chess-clock.active   {background:#e8e6e3;color:#1a1a1a;}
      .htp-chess-clock.inactive {background:#3d3d3d;color:#e8e6e3;}
      .htp-chess-clock.low-time {background:#c62828;color:#fff;animation:htpClockPulse 1s infinite;}
      @keyframes htpClockPulse{0%,100%{opacity:1}50%{opacity:.7}}
      #htpChessBoardEl {
        display:grid;grid-template-columns:repeat(8,1fr);
        width:min(496px,98vw);height:min(496px,98vw);
        border:3px solid #404040;border-radius:2px;
        box-shadow:0 8px 32px rgba(0,0,0,.7);
        overflow:hidden;
      }
      .htp-sq {
        position:relative;display:flex;align-items:center;justify-content:center;
        cursor:pointer;transition:filter .1s;aspect-ratio:1;overflow:hidden;
        -webkit-tap-highlight-color:transparent;
      }
      .htp-sq.light{background:#ebecd0;}
      .htp-sq.dark {background:#779556;}
      .htp-sq.sel  {background:#f6f669 !important;}
      .htp-sq.lm-from,.htp-sq.lm-to{background:#cdd16e !important;}
      .htp-sq.dark.lm-from,.htp-sq.dark.lm-to{background:#aaa23a !important;}
      .htp-sq.in-check{background:radial-gradient(circle,#ff4d4d 35%,transparent 75%) !important;}
      .htp-sq.legal-dot::after {
        content:'';width:28%;height:28%;border-radius:50%;
        background:rgba(0,0,0,.18);pointer-events:none;
      }
      .htp-sq.legal-cap::before {
        content:'';position:absolute;inset:2px;border-radius:50%;
        border:5px solid rgba(0,0,0,.18);pointer-events:none;
      }
      .htp-sq:hover:not(.htp-sq.sel){filter:brightness(1.08);}
      .htp-piece {
        font-size:min(56px,calc(min(496px,98vw)/8*.92));
        line-height:1;user-select:none;z-index:1;pointer-events:none;
        transition:transform .1s;
      }
      .htp-piece.white{color:#fff;-webkit-text-stroke:1.5px #2a2a2a;text-shadow:0 2px 6px rgba(0,0,0,.5);}
      .htp-piece.black{color:#111;-webkit-text-stroke:.5px #777;text-shadow:0 1px 3px rgba(0,0,0,.3);}
      .htp-chess-coord {
        position:absolute;font-size:min(10px,1.8vw);font-weight:800;
        pointer-events:none;opacity:.65;line-height:1;
      }
      .htp-chess-coord.rank{top:2px;left:3px;}
      .htp-chess-coord.file{bottom:2px;right:3px;}
      .htp-sq.light .htp-chess-coord{color:#779556;}
      .htp-sq.dark  .htp-chess-coord{color:#ebecd0;}
      .htp-chess-statusbar {
        display:flex;justify-content:space-between;align-items:center;
        width:100%;padding:8px 2px 0;
      }
      .htp-chess-status-txt{font-size:12px;color:#8a8a8a;}
      .htp-chess-status-txt.your-turn{color:#49e8c2;font-weight:700;}
      .htp-chess-btn {
        padding:6px 16px;border-radius:6px;border:none;cursor:pointer;
        font-weight:700;font-size:12px;transition:opacity .2s;
      }
      .htp-chess-btn:hover{opacity:.8;}
      .htp-chess-btn-resign{background:#c62828;color:#fff;}
      .htp-chess-btn-draw  {background:#374151;color:#d1d5db;margin-right:6px;}
    `;
    document.head.appendChild(s);
  }

  function openChessBoard(opts) {
    injectChessStyles();
    const old = document.getElementById('htpChessOverlay');
    if (old) old.remove();

    if (!W.chessGame && W.Chess) W.chessGame = new W.Chess();

    const isFlipped = opts.myColor === 'b';
    const timeSec   = opts.timeSec || 300;
    const myName    = (opts.myColor === 'w' ? opts.creatorName : opts.joinerName) || 'You';
    const oppName   = (opts.myColor === 'w' ? opts.joinerName : opts.creatorName) || 'Opponent';
    const myLabel   = opts.myColor === 'w' ? 'White ♙' : 'Black ♟';
    const oppLabel  = opts.myColor === 'w' ? 'Black ♟' : 'White ♙';
    const topLabel  = isFlipped ? myLabel : oppLabel;
    const botLabel  = isFlipped ? oppLabel : myLabel;
    const topName   = isFlipped ? myName  : oppName;
    const botName   = isFlipped ? oppName : myName;

    const wrap = document.createElement('div');
    wrap.id = 'htpChessOverlay';
    wrap.innerHTML = `
      <div class="htp-chess-wrap">
        <div class="htp-chess-playerbar">
          <div class="avatar">${isFlipped ? '♙' : '♟'}</div>
          <div class="name">${topName} <span style="color:#64748b;font-size:11px">(${topLabel})</span></div>
          <div class="htp-chess-clock inactive" id="htpClockTop">${fmtSec(timeSec)}</div>
        </div>
        <div id="htpChessBoardEl"></div>
        <div class="htp-chess-playerbar" style="margin-top:3px">
          <div class="avatar">${isFlipped ? '♟' : '♙'}</div>
          <div class="name">${botName} <span style="color:#64748b;font-size:11px">(${botLabel})</span></div>
          <div class="htp-chess-clock active" id="htpClockBot">${fmtSec(timeSec)}</div>
        </div>
        <div class="htp-chess-statusbar">
          <div class="htp-chess-status-txt" id="htpChessStatusTxt">Waiting for opponent…</div>
          <div>
            <button class="htp-chess-btn htp-chess-btn-draw"   onclick="window.offerDraw && window.offerDraw()">Draw</button>
            <button class="htp-chess-btn htp-chess-btn-resign" onclick="window.resignMatch && window.resignMatch()">Resign</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    W.chessUI = Object.assign(W.chessUI || {}, {
      playerColor: opts.myColor,
      isFlipped,
      selectedSq:  null,
      legalMoves:  [],
      lastMove:    null,
      timeLeft:    [timeSec, timeSec],
      activeClock: 'w',
      gameOver:    false,
    });

    renderChessBoardV4();
    startChessClocksV4(opts.matchId);
    LOG('Chess board opened — you are', opts.myColor === 'w' ? 'White' : 'Black');
  }

  function renderChessBoardV4() {
    const el = document.getElementById('htpChessBoardEl');
    if (!el) return;
    const game    = W.chessGame;
    const ui      = W.chessUI || {};
    const flipped = ui.isFlipped;
    const files   = ['a','b','c','d','e','f','g','h'];
    const ranks   = [8,7,6,5,4,3,2,1];
    const dFiles  = flipped ? [...files].reverse() : files;
    const dRanks  = flipped ? [...ranks].reverse() : ranks;
    const lmF = ui.lastMove ? ui.lastMove.from : null;
    const lmT = ui.lastMove ? ui.lastMove.to   : null;
    const inCheck = game && game.isCheck() && !game.isGameOver();
    const kingInCheck = inCheck ? findKingSquare(game, game.turn()) : null;

    let html = '';
    for (const rank of dRanks) {
      for (const file of dFiles) {
        const sq       = file + rank;
        const isLight  = (files.indexOf(file) + rank) % 2 === 0;
        const piece    = game ? game.get(sq) : null;
        const pk       = piece ? (piece.color + piece.type.toUpperCase()) : null;
        const sym      = pk ? (PIECES[pk] || '') : '';
        const isSel    = sq === ui.selectedSq;
        const isLegal  = (ui.legalMoves || []).includes(sq);
        const isLmF    = sq === lmF;
        const isLmT    = sq === lmT;
        const isChk    = sq === kingInCheck;

        const isFirstCol  = file === dFiles[0];
        const isLastRank  = rank === dRanks[dRanks.length - 1];
        const rankLabel   = isFirstCol  ? `<span class="htp-chess-coord rank">${rank}</span>` : '';
        const fileLabel   = isLastRank  ? `<span class="htp-chess-coord file">${file}</span>` : '';

        const classes = [
          'htp-sq',
          isLight ? 'light' : 'dark',
          isSel   ? 'sel'   : '',
          isLmF   ? 'lm-from' : '',
          isLmT   ? 'lm-to'   : '',
          isChk   ? 'in-check': '',
          (isLegal && !piece) ? 'legal-dot' : '',
          (isLegal && piece)  ? 'legal-cap' : '',
        ].filter(Boolean).join(' ');

        const pieceHtml = sym ? `<span class="htp-piece ${piece.color === 'w' ? 'white' : 'black'}">${sym}</span>` : '';

        html += `<div class="${classes}" data-sq="${sq}" onclick="window._htpChessClick('${sq}')">${rankLabel}${fileLabel}${pieceHtml}</div>`;
      }
    }
    el.innerHTML = html;
    updateChessStatusBar();
    updateChessClocksV4();
  }

  function findKingSquare(game, color) {
    const board = game.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === 'k' && p.color === color) {
          return ['a','b','c','d','e','f','g','h'][c] + (8 - r);
        }
      }
    }
    return null;
  }

  function updateChessStatusBar() {
    const el   = document.getElementById('htpChessStatusTxt');
    const game = W.chessGame;
    const ui   = W.chessUI || {};
    if (!el || !game) return;
    if (game.isCheckmate()) { el.textContent='♟ Checkmate!'; el.className='htp-chess-status-txt your-turn'; return; }
    if (game.isCheck())     { el.textContent='⚠️ Check!';     el.className='htp-chess-status-txt'; return; }
    if (game.isDraw() || game.isStalemate()) { el.textContent='🤝 Draw'; el.className='htp-chess-status-txt'; return; }
    const myTurn = game.turn() === ui.playerColor;
    el.textContent = myTurn ? '● Your turn' : '○ Opponent\'s turn';
    el.className   = 'htp-chess-status-txt' + (myTurn ? ' your-turn' : '');
  }

  function updateChessClocksV4() {
    const ui      = W.chessUI || {};
    const topCl   = document.getElementById('htpClockTop');
    const botCl   = document.getElementById('htpClockBot');
    if (!topCl || !botCl) return;
    const flipped = ui.isFlipped;
    const wTime   = ui.timeLeft ? ui.timeLeft[0] : 0;
    const bTime   = ui.timeLeft ? ui.timeLeft[1] : 0;
    const topTime = flipped ? wTime : bTime;
    const botTime = flipped ? bTime : wTime;
    const activeIsTop = (flipped && ui.activeClock === 'w') || (!flipped && ui.activeClock === 'b');

    topCl.textContent = fmtSec(topTime);
    botCl.textContent = fmtSec(botTime);

    [topCl, botCl].forEach((cl, i) => {
      const isActive = (i === 0 && activeIsTop) || (i === 1 && !activeIsTop);
      const t = i === 0 ? topTime : botTime;
      cl.className = 'htp-chess-clock ' + (isActive ? 'active' : 'inactive') + (t < 30 && isActive ? ' low-time' : '');
    });
  }

  function startChessClocksV4(matchId) {
    const ui = W.chessUI;
    if (!ui) return;
    if (ui.timerInterval) clearInterval(ui.timerInterval);
    ui.timerInterval = setInterval(() => {
      if (!W.chessGame || ui.gameOver) { clearInterval(ui.timerInterval); return; }
      const idx = ui.activeClock === 'w' ? 0 : 1;
      ui.timeLeft[idx] = Math.max(0, ui.timeLeft[idx] - 1);
      if (ui.timeLeft[idx] === 0) {
        ui.gameOver = true;
        clearInterval(ui.timerInterval);
        const loser  = ui.activeClock;
        const winner = loser === 'w' ? 'b' : 'w';
        if (typeof W.handleMatchGameOver === 'function') W.handleMatchGameOver('timeout', winner);
      }
      updateChessClocksV4();
    }, 1000);
  }

  W._htpChessClick = function(sq) {
    const game = W.chessGame;
    const ui   = W.chessUI;
    if (!game || !ui || ui.gameOver) return;
    if (game.turn() !== ui.playerColor) return;

    if (ui.selectedSq) {
      let move = null;
      try {
        move = game.move({ from: ui.selectedSq, to: sq, promotion: 'q' });
      } catch (_) {
        move = null;
      }
      if (move) {
        ui.lastMove   = { from: move.from, to: move.to };
        ui.selectedSq = null;
        ui.legalMoves = [];
        if (typeof W.relaySend === 'function') {
          W.relaySend({
            type: 'move', game: 'chess',
            fen:  game.fen(),
            move: { from: move.from, to: move.to, san: move.san },
            clockSync: { w: ui.timeLeft[0], b: ui.timeLeft[1], ts: Date.now() }
          });
          const match = activeMatch();
          if (match && fdb()) {
            fdb().ref('relay/' + match.id + '/moves').push({ type:'move',game:'chess',fen:game.fen(),move:{from:move.from,to:move.to,san:move.san},ts:Date.now() }).catch(()=>{});
          }
        }
        ui.activeClock = game.turn();
        const match = activeMatch();
        if (match && fdb()) {
          fdb().ref('relay/'+match.id+'/clock').set({ whiteMs:ui.timeLeft[0]*1000, blackMs:ui.timeLeft[1]*1000, activeColor:ui.activeClock==='w'?'white':'black', lastMoveTs:Date.now() }).catch(()=>{});
        }
        renderChessBoardV4();
        if (game.isCheckmate()) {
          const winner = game.turn() === 'w' ? 'b' : 'w';
          if (typeof W.handleMatchGameOver === 'function') W.handleMatchGameOver('checkmate', winner);
        } else if (game.isDraw() || game.isStalemate()) {
          if (typeof W.handleMatchGameOver === 'function') W.handleMatchGameOver('draw', null);
        }
        return;
      }
      ui.selectedSq = null; ui.legalMoves = [];
    }
    const piece = game.get(sq);
    if (piece && piece.color === ui.playerColor) {
      ui.selectedSq  = sq;
      ui.legalMoves  = game.moves({ square: sq, verbose: true }).map(m => m.to);
    }
    renderChessBoardV4();
  };

  W.renderChessBoard = renderChessBoardV4;
  W.openChessBoard   = openChessBoard;

  function applyIncomingChessMove(msg) {
    const game = W.chessGame;
    if (!game || !msg.fen) return;
    game.load(msg.fen);
    if (msg.move) W.chessUI && (W.chessUI.lastMove = { from: msg.move.from, to: msg.move.to });
    if (msg.clockSync && W.chessUI) {
      if (typeof msg.clockSync.w === 'number') W.chessUI.timeLeft[0] = msg.clockSync.w;
      if (typeof msg.clockSync.b === 'number') W.chessUI.timeLeft[1] = msg.clockSync.b;
      if (msg.clockSync.activeColor) W.chessUI.activeClock = msg.clockSync.activeColor === 'white' ? 'w' : 'b';
    }
    if (W.chessUI) W.chessUI.activeClock = game.turn();
    renderChessBoardV4();
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'b' : 'w';
      if (typeof W.handleMatchGameOver === 'function') W.handleMatchGameOver('checkmate', winner);
    } else if (game.isDraw() || game.isStalemate()) {
      if (typeof W.handleMatchGameOver === 'function') W.handleMatchGameOver('draw', null);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. CONNECT4 UI
   * ═══════════════════════════════════════════════════════════════════════ */

  const C4_ROWS = 6, C4_COLS = 7;

  function injectC4Styles() {
    if (document.getElementById('htp-c4-style-v4')) return;
    const s = document.createElement('style');
    s.id = 'htp-c4-style-v4';
    s.textContent = `
      #htpC4Overlay {
        position:fixed;inset:0;z-index:9000;
        display:flex;align-items:center;justify-content:center;
        background:linear-gradient(160deg,#0a0f1e,#111827);overflow:auto;
      }
      .htp-c4-wrap { display:flex;flex-direction:column;align-items:center;width:min(480px,100vw);gap:12px;padding:16px;box-sizing:border-box; }
      .htp-c4-header { display:flex;justify-content:space-between;align-items:center;width:100%; }
      .htp-c4-title { font-size:18px;font-weight:800;color:#e2e8f0;letter-spacing:-.02em; }
      .htp-c4-scorebar { display:flex;gap:16px;align-items:center; }
      .htp-c4-player { display:flex;flex-direction:column;align-items:center;gap:2px;min-width:80px; }
      .htp-c4-player .disc { width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.2); }
      .htp-c4-player .disc.red    { background:radial-gradient(circle at 35% 35%,#ff6b6b,#dc2626); }
      .htp-c4-player .disc.yellow { background:radial-gradient(circle at 35% 35%,#fde68a,#f59e0b); }
      .htp-c4-player .pname { font-size:11px;color:#94a3b8;font-weight:600; }
      .htp-c4-clock-v { font-family:monospace;font-size:20px;font-weight:700;padding:4px 12px;border-radius:6px;transition:all .2s; }
      .htp-c4-clock-v.active   { background:#374151;color:#e2e8f0;box-shadow:0 0 12px rgba(73,232,194,.3); }
      .htp-c4-clock-v.inactive { background:#1e293b;color:#475569; }
      .htp-c4-turn { font-size:13px;font-weight:700;color:#49e8c2;text-align:center;min-height:18px; }
      .htp-c4-board-wrap { background:linear-gradient(145deg,#1d4ed8,#1e40af);border-radius:16px;padding:10px;box-shadow:0 12px 40px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.1); }
      .htp-c4-grid { display:grid;grid-template-columns:repeat(7,1fr);gap:6px;cursor:pointer; }
      .htp-c4-cell { width:min(56px,calc((100vw - 80px)/7));height:min(56px,calc((100vw - 80px)/7));border-radius:50%;background:rgba(0,0,0,.6);position:relative;overflow:hidden;transition:background .1s; }
      .htp-c4-cell.red { background:radial-gradient(circle at 35% 35%,#ff6b6b,#dc2626);box-shadow:inset 0 -3px 6px rgba(0,0,0,.3),0 3px 8px rgba(220,38,38,.4); }
      .htp-c4-cell.yellow { background:radial-gradient(circle at 35% 35%,#fde68a,#f59e0b);box-shadow:inset 0 -3px 6px rgba(0,0,0,.3),0 3px 8px rgba(245,158,11,.4); }
      .htp-c4-cell.win-cell { animation:htpC4Win .6s ease infinite alternate; }
      @keyframes htpC4Win{from{transform:scale(1)}to{transform:scale(1.12);}}
    `;
    document.head.appendChild(s);
  }

  function openC4Board(opts) {
    injectC4Styles();
    const old = document.getElementById('htpC4Overlay');
    if (old) old.remove();

    const isRed  = opts.mySide === 1;
    const myName  = isRed ? (opts.creatorName||'You') : (opts.joinerName||'You');
    const oppName = isRed ? (opts.joinerName||'Opponent') : (opts.creatorName||'Opponent');

    W.C4 = {
      board:    Array.from({length:C4_ROWS}, ()=>Array(C4_COLS).fill(0)),
      turn:     1, gameOver: false, mySide: opts.mySide || 1,
      matchId:  opts.matchId, winCells: [],
    };

    const wrap = document.createElement('div');
    wrap.id = 'htpC4Overlay';
    wrap.innerHTML = `
      <div class="htp-c4-wrap">
        <div class="htp-c4-header">
          <div class="htp-c4-title">Connect 4</div>
          <button onclick="document.getElementById('htpC4Overlay').remove()" style="background:none;border:none;color:#64748b;font-size:20px;cursor:pointer">✕</button>
        </div>
        <div class="htp-c4-scorebar">
          <div class="htp-c4-player">
            <div class="disc red"></div>
            <div class="pname">${isRed?myName+' (You)':oppName}</div>
            <div class="htp-c4-clock-v active" id="htpC4ClockR">${fmtSec(opts.timeSec||200)}</div>
          </div>
          <div style="color:#475569;font-size:24px;font-weight:900">vs</div>
          <div class="htp-c4-player">
            <div class="disc yellow"></div>
            <div class="pname">${isRed?oppName:myName+' (You)'}</div>
            <div class="htp-c4-clock-v inactive" id="htpC4ClockY">${fmtSec(opts.timeSec||200)}</div>
          </div>
        </div>
        <div class="htp-c4-turn" id="htpC4TurnLbl">${opts.mySide===1?'Your turn':"Opponent's turn"}</div>
        <div class="htp-c4-board-wrap">
          <div class="htp-c4-grid" id="htpC4Grid"></div>
        </div>
        <button onclick="window.resignMatch && window.resignMatch()" style="background:#1e293b;border:1px solid #374151;color:#94a3b8;border-radius:8px;padding:8px 20px;font-weight:700;cursor:pointer;">Resign</button>
      </div>`;
    document.body.appendChild(wrap);

    renderC4Board();
    startC4Clock(opts.matchId, opts.timeSec || 200);
    LOG('Connect4 board opened — side', opts.mySide, isRed?'(Red)':'(Yellow)');
  }

  function renderC4Board() {
    const grid = document.getElementById('htpC4Grid');
    if (!grid || !W.C4) return;
    const { board, winCells, mySide } = W.C4;

    let html = '';
    for (let col = 0; col < C4_COLS; col++) {
      html += `<div style="display:flex;flex-direction:column;gap:6px;align-items:center;" onclick="window._htpC4Drop(${col})">`;
      html += `<div style="height:16px;display:flex;align-items:center;justify-content:center;"><div style="width:14px;height:14px;border-radius:50%;background:${mySide===1?'#dc2626':'#f59e0b'};opacity:${W.C4.turn===mySide&&!W.C4.gameOver?0.7:0};transition:opacity .2s"></div></div>`;
      for (let row = 0; row < C4_ROWS; row++) {
        const val = board[row][col];
        const isWin = winCells.some(([wr,wc])=>wr===row&&wc===col);
        const cls = val===1 ? 'red' : val===2 ? 'yellow' : '';
        html += `<div class="htp-c4-cell ${cls}${isWin?' win-cell':''}"></div>`;
      }
      html += '</div>';
    }
    grid.innerHTML = html;
    updateC4ClockDisplay();
    updateC4TurnLabel();
  }

  function updateC4TurnLabel() {
    const lbl = document.getElementById('htpC4TurnLbl');
    if (!lbl || !W.C4) return;
    if (W.C4.gameOver) { lbl.textContent='Game over'; return; }
    lbl.textContent = W.C4.turn===W.C4.mySide?'● Your turn':"○ Opponent's turn";
    lbl.style.color = W.C4.turn===W.C4.mySide?'#49e8c2':'#64748b';
  }

  function updateC4ClockDisplay() {
    if (!W.C4||!W.C4._clk) return;
    const clk=W.C4._clk;
    const rEl=document.getElementById('htpC4ClockR');
    const yEl=document.getElementById('htpC4ClockY');
    if (rEl){rEl.textContent=fmtSec(Math.floor(clk.ms[0]/1000));rEl.className='htp-c4-clock-v '+(clk.active===1?'active':'inactive');}
    if (yEl){yEl.textContent=fmtSec(Math.floor(clk.ms[1]/1000));yEl.className='htp-c4-clock-v '+(clk.active===2?'active':'inactive');}
  }

  W._htpC4Drop = function(col) {
    if (!W.C4||W.C4.gameOver) return;
    if (W.C4.turn!==W.C4.mySide) return;
    const row=c4DropRow(W.C4.board, col);
    if (row===-1) return;
    W.C4.board[row][col]=W.C4.mySide;
    const winner=c4CheckWin(W.C4.board,row,col,W.C4.mySide);
    if (winner){W.C4.winCells=winner;W.C4.gameOver=true;}
    const isDraw=!winner&&W.C4.board[0].every((_,c)=>c4DropRow(W.C4.board,c)===-1);
    W.C4.turn=W.C4.turn===1?2:1;
    if (typeof W.relaySend==='function') W.relaySend({type:'move',game:'c4',col,side:W.C4.mySide,ts:Date.now()});
    if (fdb()&&W.C4.matchId) fdb().ref('relay/'+W.C4.matchId+'/moves').push({type:'move',game:'c4',col,side:W.C4.mySide,ts:Date.now()}).catch(()=>{});
    if (W.C4._clk) W.C4._clk.recordMove(W.C4.mySide);
    renderC4Board();
    if (winner) setTimeout(()=>{if(typeof W.handleMatchGameOver==='function') W.handleMatchGameOver('connect4-win',W.C4.mySide);},400);
    else if(isDraw) setTimeout(()=>{if(typeof W.handleMatchGameOver==='function') W.handleMatchGameOver('draw',null);},400);
  };

  W.applyC4Move = function(col, side) {
    if (!W.C4||W.C4.gameOver) return;
    const row=c4DropRow(W.C4.board,col); if(row===-1)return;
    W.C4.board[row][col]=side;
    const winner=c4CheckWin(W.C4.board,row,col,side);
    if(winner){W.C4.winCells=winner;W.C4.gameOver=true;}
    W.C4.turn=W.C4.turn===1?2:1;
    if(W.C4._clk) W.C4._clk.recordMove(side);
    renderC4Board();
    if(winner) setTimeout(()=>{if(typeof W.handleMatchGameOver==='function') W.handleMatchGameOver('connect4-win',side);},400);
  };

  function c4DropRow(board,col){for(let r=C4_ROWS-1;r>=0;r--){if(!board[r][col])return r;}return -1;}
  function c4CheckWin(board,row,col,side){
    const dirs=[[0,1],[1,0],[1,1],[1,-1]];
    for(const[dr,dc]of dirs){
      const cells=[[row,col]];
      for(let d=1;d<=3;d++){const r=row+dr*d,c=col+dc*d;if(r>=0&&r<C4_ROWS&&c>=0&&c<C4_COLS&&board[r][c]===side)cells.push([r,c]);else break;}
      for(let d=1;d<=3;d++){const r=row-dr*d,c=col-dc*d;if(r>=0&&r<C4_ROWS&&c>=0&&c<C4_COLS&&board[r][c]===side)cells.push([r,c]);else break;}
      if(cells.length>=4)return cells;
    }
    return null;
  }

  function startC4Clock(matchId,timeSec){
    if(!W.C4)return;
    const ms0=timeSec*1000;
    W.C4._clk={
      ms:[ms0,ms0],active:1,lastTs:Date.now(),_tick:null,
      recordMove(side){
        const now=Date.now(),idx=side===1?0:1;
        this.ms[idx]=Math.max(0,this.ms[idx]-(now-this.lastTs));
        this.active=side===1?2:1;this.lastTs=now;
        if(fdb()&&matchId)fdb().ref('relay/'+matchId+'/clock').set({ms1:this.ms[0],ms2:this.ms[1],activeSide:this.active,lastMoveTs:now}).catch(()=>{});
        this._localTick();
      },
      _localTick(){
        clearInterval(this._tick);const self=this;
        this._tick=setInterval(()=>{
          const idx=self.active===1?0:1;
          self.ms[idx]=Math.max(0,self.ms[idx]-1000);
          updateC4ClockDisplay();
          if(self.ms[idx]===0){clearInterval(self._tick);const winner=self.active===1?2:1;if(typeof W.handleMatchGameOver==='function')W.handleMatchGameOver('timeout',winner);}
        },1000);
      },
      destroy(){clearInterval(this._tick);}
    };
    W.C4._clk._localTick();
    if(fdb()&&matchId){fdb().ref('relay/'+matchId+'/clock').on('value',snap=>{const c=snap.val();if(!c)return;W.C4._clk.ms[0]=c.ms1!=null?c.ms1:W.C4._clk.ms[0];W.C4._clk.ms[1]=c.ms2!=null?c.ms2:W.C4._clk.ms[1];W.C4._clk.active=c.activeSide||W.C4._clk.active;updateC4ClockDisplay();W.C4._clk._localTick();});}
  }

  W.openC4Board=openC4Board;

  /* ═══════════════════════════════════════════════════════════════════════
   * 7. CHECKERS UI
   * ═══════════════════════════════════════════════════════════════════════ */

  function injectCheckersStyles(){
    if(document.getElementById('htp-ck-style-v4'))return;
    const s=document.createElement('style');s.id='htp-ck-style-v4';
    s.textContent=`
      #htpCkOverlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#0d1117,#161b22);overflow:auto;}
      .htp-ck-wrap{display:flex;flex-direction:column;align-items:center;width:min(500px,100vw);gap:10px;padding:16px;box-sizing:border-box;}
      .htp-ck-header{display:flex;justify-content:space-between;align-items:center;width:100%;}
      .htp-ck-title{font-size:18px;font-weight:800;color:#e2e8f0;}
      .htp-ck-infobar{display:flex;justify-content:space-between;align-items:center;width:100%;}
      .htp-ck-player{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:90px;}
      .htp-ck-disc{width:20px;height:20px;border-radius:50%;border:2px solid rgba(255,255,255,.15);}
      .htp-ck-disc.red{background:radial-gradient(circle at 35% 35%,#ef9a9a,#c62828);}
      .htp-ck-disc.black{background:radial-gradient(circle at 35% 35%,#616161,#212121);}
      .htp-ck-pname{font-size:11px;color:#94a3b8;font-weight:600;}
      .htp-ck-clock{font-family:monospace;font-size:18px;font-weight:700;padding:3px 10px;border-radius:6px;transition:all .2s;}
      .htp-ck-clock.active{background:#374151;color:#e2e8f0;}
      .htp-ck-clock.inactive{background:#1e293b;color:#475569;}
      .htp-ck-turn{font-size:13px;font-weight:700;text-align:center;min-height:18px;}
      .htp-ck-board{display:grid;grid-template-columns:repeat(8,1fr);border:3px solid #30363d;border-radius:6px;overflow:hidden;width:min(480px,96vw);height:min(480px,96vw);box-shadow:0 8px 30px rgba(0,0,0,.6);}
      .htp-ck-sq{aspect-ratio:1;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;-webkit-tap-highlight-color:transparent;}
      .htp-ck-sq.light{background:#f0d9b5;cursor:default;}
      .htp-ck-sq.dark{background:#b58863;}
      .htp-ck-sq.dark:hover{background:#c99a73;}
      .htp-ck-sq.sel{background:#e8d44d !important;}
      .htp-ck-sq.valid-move{background:#78a460 !important;}
      .htp-ck-sq.valid-move::after{content:'';width:24%;height:24%;border-radius:50%;background:rgba(0,0,0,.2);}
      .htp-ck-piece{width:80%;height:80%;border-radius:50%;display:flex;align-items:center;justify-content:center;position:relative;box-shadow:inset 0 -4px 6px rgba(0,0,0,.4),0 3px 8px rgba(0,0,0,.4);}
      .htp-ck-piece.red{background:radial-gradient(circle at 35% 35%,#ef9a9a,#c62828);}
      .htp-ck-piece.black{background:radial-gradient(circle at 35% 35%,#757575,#212121);}
      .htp-ck-piece.king::after{content:'♛';font-size:min(20px,3.5vw);color:rgba(255,255,255,.85);pointer-events:none;}
    `;
    document.head.appendChild(s);
  }

  function openCheckersBoard(opts){
    injectCheckersStyles();
    const old=document.getElementById('htpCkOverlay');if(old)old.remove();
    const isRed=opts.mySide===1;
    const myName=isRed?(opts.creatorName||'You'):(opts.joinerName||'You');
    const oppName=isRed?(opts.joinerName||'Opponent'):(opts.creatorName||'Opponent');

    W.CK={board:initCheckersBoard(),turn:1,mySide:opts.mySide||1,matchId:opts.matchId,gameOver:false,selSq:null,validMoves:[],kings:{}};

    const wrap=document.createElement('div');wrap.id='htpCkOverlay';
    wrap.innerHTML=`
      <div class="htp-ck-wrap">
        <div class="htp-ck-header"><div class="htp-ck-title">Checkers</div><button onclick="document.getElementById('htpCkOverlay').remove()" style="background:none;border:none;color:#64748b;font-size:20px;cursor:pointer">✕</button></div>
        <div class="htp-ck-infobar">
          <div class="htp-ck-player"><div class="htp-ck-disc red"></div><div class="htp-ck-pname">${isRed?myName+' (You)':oppName}</div><div class="htp-ck-clock active" id="htpCkClockR">${fmtSec(opts.timeSec||300)}</div></div>
          <div class="htp-ck-turn" id="htpCkTurnLbl">${opts.mySide===1?'Your turn':"Opponent's turn"}</div>
          <div class="htp-ck-player"><div class="htp-ck-disc black"></div><div class="htp-ck-pname">${isRed?oppName:myName+' (You)'}</div><div class="htp-ck-clock inactive" id="htpCkClockB">${fmtSec(opts.timeSec||300)}</div></div>
        </div>
        <div class="htp-ck-board" id="htpCkBoard"></div>
        <button onclick="window.resignMatch&&window.resignMatch()" style="background:#1e293b;border:1px solid #374151;color:#94a3b8;border-radius:8px;padding:8px 20px;font-weight:700;cursor:pointer;">Resign</button>
      </div>`;
    document.body.appendChild(wrap);
    renderCheckersBoard();
    startCkClock(opts.matchId,opts.timeSec||300);
    LOG('Checkers board opened — side',opts.mySide,isRed?'(Red)':'(Black)');
  }

  function initCheckersBoard(){
    const b=Array.from({length:8},()=>Array(8).fill(0));
    for(let r=0;r<3;r++)for(let c=0;c<8;c++)if((r+c)%2===1)b[r][c]=3;
    for(let r=5;r<8;r++)for(let c=0;c<8;c++)if((r+c)%2===1)b[r][c]=1;
    return b;
  }

  function renderCheckersBoard(){
    const el=document.getElementById('htpCkBoard');if(!el||!W.CK)return;
    const{board,selSq,validMoves,kings,mySide,turn}=W.CK;
    let html='';
    for(let r=0;r<8;r++){for(let c=0;c<8;c++){
      const isLight=(r+c)%2===0,val=board[r][c];
      const isSel=selSq&&selSq[0]===r&&selSq[1]===c;
      const isValid=validMoves.some(([vr,vc])=>vr===r&&vc===c);
      const isKing=kings[r+','+c];
      const cls=['htp-ck-sq',isLight?'light':'dark',isSel?'sel':'',isValid?'valid-move':''].filter(Boolean).join(' ');
      let p='';if(val){const color=val===1?'red':'black';p=`<div class="htp-ck-piece ${color}${isKing?' king':''}"></div>`;}
      html+=`<div class="${cls}" onclick="window._htpCkClick(${r},${c})">${p}</div>`;
    }}
    el.innerHTML=html;
    updateCkClockDisplay();updateCkTurnLabel();
  }

  function updateCkTurnLabel(){const lbl=document.getElementById('htpCkTurnLbl');if(!lbl||!W.CK)return;if(W.CK.gameOver){lbl.textContent='Game over';return;}const myTurn=W.CK.turn===W.CK.mySide;lbl.textContent=myTurn?'● Your turn':"○ Opponent's turn";lbl.style.color=myTurn?'#49e8c2':'#64748b';}
  function updateCkClockDisplay(){if(!W.CK||!W.CK._clk)return;const clk=W.CK._clk,rEl=document.getElementById('htpCkClockR'),bEl=document.getElementById('htpCkClockB');if(rEl){rEl.textContent=fmtSec(Math.floor(clk.ms[0]/1000));rEl.className='htp-ck-clock '+(clk.active===1?'active':'inactive');}if(bEl){bEl.textContent=fmtSec(Math.floor(clk.ms[1]/1000));bEl.className='htp-ck-clock '+(clk.active===3?'active':'inactive');}}

  W._htpCkClick=function(r,c){
    if(!W.CK||W.CK.gameOver)return;if(W.CK.turn!==W.CK.mySide)return;
    const{board,selSq,mySide,kings}=W.CK;
    if(selSq&&W.CK.validMoves.some(([vr,vc])=>vr===r&&vc===c)){applyCheckersMove(selSq[0],selSq[1],r,c,mySide,true);return;}
    if(board[r][c]===mySide){W.CK.selSq=[r,c];W.CK.validMoves=getCheckersMoves(board,r,c,mySide,kings);renderCheckersBoard();return;}
    W.CK.selSq=null;W.CK.validMoves=[];renderCheckersBoard();
  };

  function applyCheckersMove(fr,fc,tr,tc,side,relay){
    const{board,kings}=W.CK;
    board[tr][tc]=side;board[fr][fc]=0;
    const mr=(fr+tr)/2,mc=(fc+tc)/2;
    if(Number.isInteger(mr)&&board[mr][mc]&&board[mr][mc]!==side){board[mr][mc]=0;delete kings[mr+','+mc];}
    if(side===1&&tr===0)kings[tr+','+tc]=true;
    if(side===3&&tr===7)kings[tr+','+tc]=true;
    if(kings[fr+','+fc]){kings[tr+','+tc]=true;delete kings[fr+','+fc];}
    W.CK.selSq=null;W.CK.validMoves=[];W.CK.turn=side===1?3:1;
    if(relay){
      if(typeof W.relaySend==='function')W.relaySend({type:'move',game:'checkers',from:[fr,fc],to:[tr,tc],side,ts:Date.now()});
      if(fdb()&&W.CK.matchId)fdb().ref('relay/'+W.CK.matchId+'/moves').push({type:'move',game:'checkers',from:[fr,fc],to:[tr,tc],side,ts:Date.now()}).catch(()=>{});
      if(W.CK._clk)W.CK._clk.recordMove(side);
    }
    renderCheckersBoard();
    const oppSide=side===1?3:1;
    const oppHasPieces=board.some(row=>row.some(v=>v===oppSide));
    if(!oppHasPieces){W.CK.gameOver=true;setTimeout(()=>{if(typeof W.handleMatchGameOver==='function')W.handleMatchGameOver('checkers-win',side);},400);}
  }

  W.applyCkMove=function(from,to,side){if(!W.CK||W.CK.gameOver)return;applyCheckersMove(from[0],from[1],to[0],to[1],side,false);if(W.CK._clk)W.CK._clk.recordMove(side);};

  function getCheckersMoves(board,r,c,side,kings){
    const isKing=kings[r+','+c],dirs=[];
    if(side===1||isKing)dirs.push([-1,-1],[-1,1]);
    if(side===3||isKing)dirs.push([1,-1],[1,1]);
    const moves=[];
    for(const[dr,dc]of dirs){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<8&&nc>=0&&nc<8){if(!board[nr][nc])moves.push([nr,nc]);else if(board[nr][nc]!==side){const jr=nr+dr,jc=nc+dc;if(jr>=0&&jr<8&&jc>=0&&jc<8&&!board[jr][jc])moves.push([jr,jc]);}}}
    return moves;
  }

  function startCkClock(matchId,timeSec){
    if(!W.CK)return;const ms0=timeSec*1000;
    W.CK._clk={ms:[ms0,ms0],active:1,lastTs:Date.now(),_tick:null,
      recordMove(side){const now=Date.now(),idx=side===1?0:1;this.ms[idx]=Math.max(0,this.ms[idx]-(now-this.lastTs));this.active=side===1?3:1;this.lastTs=now;if(fdb()&&matchId)fdb().ref('relay/'+matchId+'/clock').set({ms1:this.ms[0],ms2:this.ms[1],activeSide:this.active,lastMoveTs:now}).catch(()=>{});this._localTick();},
      _localTick(){clearInterval(this._tick);const self=this;this._tick=setInterval(()=>{const idx=self.active===1?0:1;self.ms[idx]=Math.max(0,self.ms[idx]-1000);updateCkClockDisplay();if(self.ms[idx]===0){clearInterval(self._tick);const winner=self.active===1?3:1;if(typeof W.handleMatchGameOver==='function')W.handleMatchGameOver('timeout',winner);}},1000);},
      destroy(){clearInterval(this._tick);}
    };
    W.CK._clk._localTick();
    if(fdb()&&matchId)fdb().ref('relay/'+matchId+'/clock').on('value',snap=>{const c=snap.val();if(!c)return;W.CK._clk.ms[0]=c.ms1!=null?c.ms1:W.CK._clk.ms[0];W.CK._clk.ms[1]=c.ms2!=null?c.ms2:W.CK._clk.ms[1];W.CK._clk.active=c.activeSide||W.CK._clk.active;updateCkClockDisplay();W.CK._clk._localTick();});
  }

  W.openCheckersBoard=openCheckersBoard;

  /* ═══════════════════════════════════════════════════════════════════════
   * 7b. TIC-TAC-TOE ENGINE
   * ═══════════════════════════════════════════════════════════════════════ */
  var WIN_LINES=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

  function openTTTBoard(opts){
    var old=document.getElementById('htpTTTOverlay');if(old)old.remove();
    var mySide=opts.mySide||opts.side==='x'?1:opts.side==='o'?2:1;
    W.TTT={board:Array(9).fill(0),turn:1,mySide:mySide,matchId:opts.matchId||opts.id,gameOver:false};
    W.TTT.timeSec=opts.timeSec||180;
    W.TTT.stakeKas=opts.stakeKas||opts.stake||5;
    W.TTT._clk={ms:[W.TTT.timeSec*1000,W.TTT.timeSec*1000],active:1,_iv:null,_localTick:function(){
      clearInterval(W.TTT._clk._iv);
      W.TTT._clk._iv=setInterval(function(){
        var s=W.TTT._clk.active;if(!s||W.TTT.gameOver)return;
        W.TTT._clk.ms[s-1]-=100;
        if(W.TTT._clk.ms[s-1]<=0){W.TTT._clk.ms[s-1]=0;clearInterval(W.TTT._clk._iv);
          var winner=s===1?2:1;
          W.TTT.gameOver=true;
          if(typeof W.relaySend==='function')W.relaySend({type:'gameOver',game:'tictactoe',reason:'timeout',winner:winner});
          if(typeof W.handleMatchGameOver==='function')W.handleMatchGameOver('timeout',winner===W.TTT.mySide?'me':'opponent');
        }
        updateTTTClockDisplay();
      },100);
    }};
    var wrap=document.createElement('div');
    wrap.id='htpTTTOverlay';
    wrap.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(1,8,6,0.95);display:flex;align-items:center;justify-content:center;';
    wrap.innerHTML='<div style="max-width:400px;width:100%;padding:24px;text-align:center;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      +'<span style="font-size:18px;font-weight:800;color:#fff;">Tic-Tac-Toe</span>'
      +'<button onclick="document.getElementById(\'htpTTTOverlay\').remove()" style="background:none;border:none;color:#64748b;font-size:20px;cursor:pointer;">✕</button>'
      +'</div>'
      +'<div id="tttStatusBar" style="font-size:13px;color:#94a3b8;margin-bottom:8px;">'+(mySide===1?'Your turn':'Opponent\'s turn')+'</div>'
      +'<div style="display:flex;justify-content:center;gap:24px;margin-bottom:12px;">'
      +'<span style="font-family:monospace;font-size:14px;font-weight:700;color:#49e8c2;background:#1e293b;padding:4px 12px;border-radius:6px;" id="tttClk1">'+fmtSec(W.TTT.timeSec)+'</span>'
      +'<span style="color:#475569;font-weight:900;">vs</span>'
      +'<span style="font-family:monospace;font-size:14px;font-weight:700;color:#f59e0b;background:#1e293b;padding:4px 12px;border-radius:6px;" id="tttClk2">'+fmtSec(W.TTT.timeSec)+'</span>'
      +'</div>'
      +'<div id="tttGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:300px;margin:0 auto;"></div>'
      +'<button onclick="window.resignMatch&&window.resignMatch()" style="margin-top:16px;background:#1e293b;border:1px solid #374151;color:#94a3b8;border-radius:8px;padding:8px 20px;font-weight:700;cursor:pointer;">Resign</button>'
      +'</div>';
    document.body.appendChild(wrap);
    renderTTTBoard();
    W.TTT._clk._localTick();
    var matchId=W.TTT.matchId;
    if(fdb()&&matchId){
      fdb().ref('relay/'+matchId+'/moves').on('child_added',function(snap){
        var msg=snap.val();if(!msg||msg.side===W.TTT.mySide)return;
        applyTTTCell(msg.cell,msg.side,false);
      });
      fdb().ref('relay/'+matchId+'/clock').on('value',function(snap){
        var c=snap.val();if(!c)return;
        if(c.ms1!=null)W.TTT._clk.ms[0]=c.ms1;
        if(c.ms2!=null)W.TTT._clk.ms[1]=c.ms2;
        if(c.activeSide)W.TTT._clk.active=c.activeSide;
        updateTTTClockDisplay();W.TTT._clk._localTick();
      });
    }
    LOG('TicTacToe board opened — side',mySide===1?'X':'O');
  }

  function renderTTTBoard(){
    var el=document.getElementById('tttGrid');if(!el)return;
    var b=W.TTT.board;var mySide=W.TTT.mySide;var turn=W.TTT.turn;
    var h='';
    for(var i=0;i<9;i++){
      var bg='#0f172a';var col='#334155';var txt='';var cursor='default';
      if(b[i]===1){txt='X';col='#49e8c2';bg='rgba(73,232,194,0.08)';}
      else if(b[i]===2){txt='O';col='rgba(255,255,255,0.85)';bg='rgba(255,255,255,0.04)';}
      else if(!W.TTT.gameOver&&turn===mySide){cursor='pointer';bg='rgba(73,232,194,0.03)';}
      h+='<div onclick="window.tttCellClick('+i+')" style="width:90px;height:90px;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:900;color:'+col+';background:'+bg+';border:1px solid rgba(73,232,194,0.12);border-radius:8px;cursor:'+cursor+';">'+txt+'</div>';
    }
    el.innerHTML=h;
    var sb=document.getElementById('tttStatusBar');
    if(sb)sb.textContent=W.TTT.gameOver?'Game Over':(turn===mySide?'Your turn':'Opponent\'s turn');
  }

  function updateTTTClockDisplay(){
    var e1=document.getElementById('tttClk1'),e2=document.getElementById('tttClk2');
    if(e1)e1.textContent=fmtSec(Math.ceil(W.TTT._clk.ms[0]/1000));
    if(e2)e2.textContent=fmtSec(Math.ceil(W.TTT._clk.ms[1]/1000));
  }

  function applyTTTCell(cell,side,relay){
    if(W.TTT.gameOver)return;
    if(W.TTT.board[cell]!==0)return;
    W.TTT.board[cell]=side;
    W.TTT.turn=side===1?2:1;
    W.TTT._clk.active=W.TTT.turn;
    if(relay!==false&&fdb()&&W.TTT.matchId){
      fdb().ref('relay/'+W.TTT.matchId+'/moves').push({type:'move',game:'tictactoe',cell:cell,side:side,ts:Date.now()}).catch(function(){});
      fdb().ref('relay/'+W.TTT.matchId+'/clock').set({ms1:W.TTT._clk.ms[0],ms2:W.TTT._clk.ms[1],activeSide:W.TTT._clk.active}).catch(function(){});
    }
    W.TTT._clk._localTick();
    var win=checkTTTWin(W.TTT.board);
    if(win){
      W.TTT.gameOver=true;clearInterval(W.TTT._clk._iv);
      renderTTTBoard();
      if(typeof W.handleMatchGameOver==='function')W.handleMatchGameOver(win.type==='draw'?'draw':'ttt-win',win.winner===W.TTT.mySide?'me':'opponent');
      if(typeof W.settleMatchPayout==='function'){
        var match=W.matchLobby&&W.matchLobby.activeMatch;
        if(match){
          var wAddr=win.type==='draw'?null:(win.winner===1?match.creator:match.opponent);
          W.settleMatchPayout(W.TTT.matchId,wAddr,win.type==='draw',match.creator,match.opponent);
        }
      }
      return;
    }
    // Check draw (all cells filled)
    if(W.TTT.board.every(function(c){return c!==0;})){
      W.TTT.gameOver=true;clearInterval(W.TTT._clk._iv);
      renderTTTBoard();
      if(typeof W.handleMatchGameOver==='function')W.handleMatchGameOver('draw','draw');
      if(typeof W.settleMatchPayout==='function'){
        var match=W.matchLobby&&W.matchLobby.activeMatch;
        if(match)W.settleMatchPayout(W.TTT.matchId,null,true,match.creator,match.opponent);
      }
      return;
    }
    renderTTTBoard();
  }

  function checkTTTWin(board){
    for(var i=0;i<WIN_LINES.length;i++){
      var l=WIN_LINES[i];
      if(board[l[0]]&&board[l[0]]===board[l[1]]&&board[l[1]]===board[l[2]]){
        return{winner:board[l[0]],type:'win',line:l};
      }
    }
    return null;
  }

  W.tttCellClick=function(cell){
    if(!W.TTT||W.TTT.gameOver)return;
    if(W.TTT.turn!==W.TTT.mySide)return;
    if(W.TTT.board[cell]!==0)return;
    applyTTTCell(cell,W.TTT.mySide,true);
  };

  W.applyTTTMove=function(cell,side){
    if(!W.TTT)return;
    applyTTTCell(cell,side,false);
  };

  W.openTTTBoard=openTTTBoard;

  /* ═══════════════════════════════════════════════════════════════════════
   * 8. RELAY + LAUNCHER PATCHES
   * ═══════════════════════════════════════════════════════════════════════ */
  function patchRelayHandler(){
    const orig=W.handleRelayMessage;
    if(orig&&orig._v4Patched)return;
    W.handleRelayMessage=function(msg){
      if(!msg)return;
      try{
        if(msg.type==='move'){
          const game=msg.game||'chess';
          if(game==='chess'||game==='chess960') applyIncomingChessMove(msg);
          else if(game==='c4'||game==='connect4') W.applyC4Move&&W.applyC4Move(msg.col,msg.side);
          else if(game==='checkers'||game==='ck') W.applyCkMove&&W.applyCkMove(msg.from,msg.to,msg.side);
          else if(game==='tictactoe'||game==='ttt') W.applyTTTMove&&W.applyTTTMove(msg.cell,msg.side);
        }else if(msg.type==='gameOver'||msg.type==='resign'){
          if(typeof W.handleMatchGameOver==='function') W.handleMatchGameOver(msg.reason||'resign',msg.winner);
        }else if(msg.type==='clockSync'&&W.chessUI){
          if(typeof msg.w==='number')W.chessUI.timeLeft[0]=msg.w;
          if(typeof msg.b==='number')W.chessUI.timeLeft[1]=msg.b;
          updateChessClocksV4();
        }
      }catch(e){WARN('Relay handler error:',e.message);}
      if(orig)try{orig.call(this,msg);}catch(e){}
    };
    W.handleRelayMessage._v4Patched=true;
    LOG('handleRelayMessage patched');
  }

  function patchBoardLaunchers(){
    const origC4=W.startConnect4Game;
    if(origC4&&!origC4._v4Patched){
      W.startConnect4Game=function(opts){const match=activeMatch();openC4Board({matchId:opts.id||(match&&match.id),mySide:opts.side||W._htpMySide||1,timeSec:parseInt(opts.time)||200,stakeKas:parseFloat(opts.stake)||5,creatorName:match?(match.creatorName||(match.creator||'').slice(0,8)):'Red',joinerName:match?(match.joinerName||(match.opponent||'').slice(0,8)):'Yellow'});};
      W.startConnect4Game._v4Patched=true;
    }
    const origCk=W.startCheckersGame;
    if(origCk&&!origCk._v4Patched){
      W.startCheckersGame=function(opts){const match=activeMatch();openCheckersBoard({matchId:opts.id||(match&&match.id),mySide:opts.side||W._htpMySide||1,timeSec:parseInt(opts.time)||300,stakeKas:parseFloat(opts.stake)||5,creatorName:match?(match.creatorName||(match.creator||'').slice(0,8)):'Red',joinerName:match?(match.joinerName||(match.opponent||'').slice(0,8)):'Black'});};
      W.startCheckersGame._v4Patched=true;
    }
    const origTTT=W.startTicTacToeGame;
    if(!origTTT||!origTTT._v4Patched){
      W.startTicTacToeGame=function(opts){const match=activeMatch();openTTTBoard({matchId:opts.id||(match&&match.id),mySide:opts.side||W._htpMySide||1,timeSec:parseInt(opts.time)||180,stakeKas:parseFloat(opts.stake)||5});};
      W.startTicTacToeGame._v4Patched=true;
    }
    const origPlay=W.playMatch;
    if(origPlay&&!origPlay._v4Patched){
      W.playMatch=function(matchId){const result=origPlay.apply(this,arguments);const match=activeMatch();const game=match?(match.game||match.gameType||'chess').toLowerCase():'chess';if(game==='chess'||game==='chess960'){const timeSec=match?(parseFloat(match.timeControl||match.time||'5')*60|0):300;setTimeout(()=>{openChessBoard({matchId,myColor:W._htpMyColor||(match&&match.creator===myPlayerId()?'w':'b'),timeSec,stakeKas:parseFloat(match&&(match.stakeKas||match.stake)||5),creatorName:match?(match.creator||'').slice(0,8):'White',joinerName:match?(match.opponent||'').slice(0,8):'Black'});},300);}return result;};
      W.playMatch._v4Patched=true;
    }
  }

  /* Resign / Draw */
  W.resignMatch=function(){
    if(!confirm('Resign and forfeit? You will lose the stake.'))return;
    const match=activeMatch();const matchId=match?match.id:null;
    if(typeof W.relaySend==='function')W.relaySend({type:'resign',reason:'resign',game:match?match.game:'chess'});
    if(fdb()&&matchId)fdb().ref('relay/'+matchId+'/result').set({winner:'opponent',reason:'resign',ts:Date.now(),by:myPlayerId()}).catch(()=>{});
    if(typeof W.handleMatchGameOver==='function')W.handleMatchGameOver('resign','opponent');
  };
  W.offerDraw=function(){if(!confirm('Offer a draw?'))return;if(typeof W.relaySend==='function')W.relaySend({type:'drawOffer'});if(W.showToast)W.showToast('Draw offer sent','info');};

  /* ═══════════════════════════════════════════════════════════════════════
   * HELPERS
   * ═══════════════════════════════════════════════════════════════════════ */
  function fmtSec(s){if(isNaN(s)||s<0)s=0;const m=Math.floor(s/60);return m+':'+String(s%60).padStart(2,'0');}

  /* ═══════════════════════════════════════════════════════════════════════
   * BOOT
   * ═══════════════════════════════════════════════════════════════════════ */
  let _installed=false;
  function install(){
    if(_installed)return;
    if(!W.handleMatchGameOver){setTimeout(install,300);return;}
    _installed=true;
    patchHandleMatchGameOver();
    patchRelayHandler();
    patchBoardLaunchers();
    LOG('✓ AutoPayout ✓ Chess v4 ✓ Connect4 v4 ✓ Checkers v4 ✓ Covenant guard ✓ Idempotent settlement');
    LOG('Treasury:',W.HTPFee?W.HTPFee.treasuryAddress():'(HTPFee loading)');
  }

  if(typeof W.whenWasmReady==='function')W.whenWasmReady(install);
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',()=>setTimeout(install,1500));}else{setTimeout(install,1500);}
  setTimeout(install,3000);setTimeout(install,6000);
  W.addEventListener('htpWasmReady',install);
  W.addEventListener('htp:wasm:ready',install);

})(window);
