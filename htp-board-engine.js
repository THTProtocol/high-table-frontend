/**
 * htp-board-engine.js  — HTP Board Engine v2
 * Game Engine Coordinator: detects game type, initializes the correct board,
 * manages turn switching, clocks, move relay, and game-end detection.
 *
 * Works with the new index.html DOM structure:
 *   #game-board-area > .game-board-container
 *     #clock-top, #clock-bottom
 *     #chess-board, #c4-board, #checkers-board
 *     .game-controls (Draw / Resign)
 *
 * LOAD ORDER: after firebase, chess.min.js, and all htp-*.js modules
 */
;(function () {
  'use strict';

  const LOG = (...a) => console.log('[HTP Board Engine v2]', ...a);
  const ERR = (...a) => console.error('[HTP Board Engine v2]', ...a);

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /** Format seconds as M:SS */
  function fmtTime(s) {
    if (s <= 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return `${m}:${sec}`;
  }

  /** Parse "5+0", "10+5", "5", "90" into { minutes, increment } */
  function parseTimeControl(str) {
    const parts = String(str || '5+0').split('+');
    const minutes = parseFloat(parts[0]) || 5;
    const increment = parseFloat(parts[1]) || 0;
    return { minutes, increment };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 0. STAKE PATCHES — fix hard-coded 5 KAS from htp-multi-fix.js
  // ─────────────────────────────────────────────────────────────────────────

  function patchJoinAmount() {
    const orig = window.joinLobbyMatch;
    if (!orig || orig._boardEnginePatched) return;

    window.joinLobbyMatch = async function (matchId) {
      const m = resolveMatch(matchId);
      if (m) {
        const stakeKas = parseFloat(m.stakeKas || m.stake || m.escrowKas || 0);
        const stakeSompi = Math.round(stakeKas * 1e8);
        if (stakeSompi > 0) {
          m.stakeKas   = stakeKas;
          m.stakeSompi = stakeSompi;
          m.amount     = stakeSompi;
          LOG(`stake normalised: ${stakeKas} KAS -> ${stakeSompi} sompi`);
        }
      }
      return orig.call(this, matchId);
    };
    window.joinLobbyMatch._boardEnginePatched = true;
    LOG('joinLobbyMatch stake patch installed');
  }

  function patchSendTxAmount() {
    const orig = window.htpSendTx;
    if (!orig || orig._boardEnginePatched) return;

    window.htpSendTx = async function (toOrOpts, amountRaw, opts) {
      let to, amountSompi, extraOpts;

      if (toOrOpts && typeof toOrOpts === 'object' && !Array.isArray(toOrOpts)) {
        to        = toOrOpts.to || toOrOpts.address || toOrOpts.recipient;
        amountRaw = toOrOpts.amount ?? toOrOpts.sompi ?? toOrOpts.value ?? amountRaw;
        extraOpts = toOrOpts;
      } else {
        to        = toOrOpts;
        extraOpts = opts || {};
      }

      // Resolve amount: KAS float -> sompi, or pass-through if already sompi
      if (typeof amountRaw === 'number') {
        amountSompi = amountRaw < 1e7 ? Math.round(amountRaw * 1e8) : Math.round(amountRaw);
      } else if (typeof amountRaw === 'bigint') {
        amountSompi = Number(amountRaw);
      } else if (typeof amountRaw === 'string') {
        amountSompi = parseInt(amountRaw, 10);
      }

      // Last resort: recover from match store via matchId
      if (!amountSompi || isNaN(amountSompi)) {
        const mid = extraOpts.matchId;
        if (mid) {
          const rec = resolveMatch(mid);
          if (rec) {
            const kas = parseFloat(rec.stakeKas || rec.stake || 0);
            if (kas > 0) amountSompi = Math.round(kas * 1e8);
          }
        }
      }

      // Also pull from opts fields
      if (!amountSompi || isNaN(amountSompi)) {
        const v = extraOpts.amount ?? extraOpts.sompi ?? extraOpts.stake;
        if (v) {
          const n = parseFloat(v);
          amountSompi = n < 1e7 ? Math.round(n * 1e8) : Math.round(n);
        }
      }

      if (!amountSompi || isNaN(amountSompi) || amountSompi <= 0) {
        ERR('BLOCKED - cannot resolve amount. Raw:', amountRaw, 'opts:', extraOpts);
        throw new Error('htpSendTx: amount could not be resolved');
      }

      const mergedOpts = Object.assign({}, extraOpts, { amount: amountSompi });
      LOG(`Sending tx -> ${String(to).slice(0, 30)}... ${amountSompi} sompi`);
      return orig.call(this, to, amountSompi, mergedOpts);
    };
    window.htpSendTx._boardEnginePatched = true;
    LOG('htpSendTx amount patch installed');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. BOARD-OPEN PATCHES — optimistic board for creator + joiner
  // ─────────────────────────────────────────────────────────────────────────

  function patchCreateForCreatorBoard() {
    const orig = window.createMatchWithLobby;
    if (!orig || orig._boardEngineCreatorPatched) return;

    window.createMatchWithLobby = async function (...args) {
      let matchId = null;
      try {
        const result = await orig.apply(this, args);
        if (result && result.id) matchId = result.id;
        if (!matchId && window.matchLobby && window.matchLobby.matches &&
            window.matchLobby.matches.length) {
          matchId = window.matchLobby.matches[window.matchLobby.matches.length - 1].id;
        }
        if (matchId) {
          LOG('Creator board opening for', matchId);
          setTimeout(() => openGameBoard(matchId, 'creator'), 600);
        }
        return result;
      } catch (e) {
        ERR('createMatchWithLobby error', e);
        throw e;
      }
    };
    window.createMatchWithLobby._boardEngineCreatorPatched = true;
    LOG('createMatchWithLobby creator-board patch installed');
  }

  function patchJoinForBoard() {
    const orig = window.joinLobbyMatch;
    if (!orig || orig._boardEngineJoinPatched) return;

    window.joinLobbyMatch = async function (matchId) {
      try {
        const result = await orig.call(this, matchId);
        LOG('Joiner board opening for', matchId);
        setTimeout(() => openGameBoard(matchId, 'joiner'), 600);
        return result;
      } catch (e) {
        ERR('joinLobbyMatch error', e);
        throw e;
      }
    };
    window.joinLobbyMatch._boardEngineJoinPatched = true;
    LOG('joinLobbyMatch board patch installed');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. MATCH RESOLVER — find match object from any available store
  // ─────────────────────────────────────────────────────────────────────────

  function resolveMatch(matchId) {
    const stores = [
      window.htpMatches,
      window.openMatches,
      window.matchLobby && window.matchLobby.matches
        ? Object.fromEntries((window.matchLobby.matches || []).map(x => [x.id, x]))
        : null
    ].filter(Boolean);

    for (const s of stores) {
      if (s[matchId]) return s[matchId];
    }
    // Also check matchLobby.matches as array
    if (window.matchLobby && Array.isArray(window.matchLobby.matches)) {
      const found = window.matchLobby.matches.find(x => x.id === matchId);
      if (found) return found;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. CORE: openGameBoard — unified board launcher
  // ─────────────────────────────────────────────────────────────────────────

  async function openGameBoard(matchId, role) {
    let m = resolveMatch(matchId);

    // Firebase fallback
    if (!m && window.firebase) {
      try {
        const snap = await firebase.database().ref(`matches/${matchId}/info`).once('value');
        if (snap.val()) {
          m = snap.val();
          m.id = matchId;
        }
      } catch (e) { /* ignore */ }
    }

    if (!m) {
      ERR('openGameBoard: match not found', matchId);
      return;
    }

    const game = (m.game || m.gameType || 'chess').toLowerCase();
    const myId = window.matchLobby && window.matchLobby.myPlayerId;
    const isCreator = m.creator === myId;

    // Determine color assignment (deterministic, stored to Firebase)
    const mySide = await resolveColorAssignment(matchId, m, isCreator);

    // Parse time control
    const tc = parseTimeControl(m.timeControl || m.time || '5+0');

    const opts = {
      id:        matchId,
      side:      mySide,
      minutes:   tc.minutes,
      increment: tc.increment,
      timeSec:   Math.round(tc.minutes * 60),
      stake:     parseFloat(m.stakeKas || m.stake || 5),
      game,
      creator:   m.creator,
      opponent:  m.opponent,
      role
    };

    // Store as active match
    if (window.matchLobby) window.matchLobby.activeMatch = m;

    LOG(`Opening ${game} board for ${matchId}, side=${mySide}, role=${role}`);

    // Connect relay BEFORE opening board so we don't miss moves
    if (typeof window.connectRelay === 'function') {
      window.connectRelay(matchId, game);
    }

    // Replay move history so joiner catches up
    await replayMoveHistory(matchId, game);

    // Show the game board area
    const boardArea = document.getElementById('game-board-area');
    if (boardArea) boardArea.classList.remove('hidden');

    // Hide all sub-boards, then show the correct one
    ['chess-board', 'c4-board', 'checkers-board', 'ttt-board'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    if (game === 'chess' || game === 'chess960') {
      const el = document.getElementById('chess-board');
      if (el) el.classList.remove('hidden');
      launchChessBoard(opts);
    } else if (game === 'c4' || game === 'connect4') {
      const el = document.getElementById('c4-board');
      if (el) el.classList.remove('hidden');
      launchConnect4Board(opts);
    } else if (game === 'ck' || game === 'checkers') {
      const el = document.getElementById('checkers-board');
      if (el) el.classList.remove('hidden');
      launchCheckersBoard(opts);
    } else if (game === 'ttt' || game === 'tictactoe') {
      const el = document.getElementById('ttt-board');
      if (el) el.classList.remove('hidden');
      if (typeof window.openTTTBoard === 'function') window.openTTTBoard(opts);
      else ERR('openTTTBoard not found');
    } else {
      ERR('Unknown game type:', game);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. COLOR ASSIGNMENT — deterministic + Firebase-confirmed
  // ─────────────────────────────────────────────────────────────────────────

  async function resolveColorAssignment(matchId, m, isCreator) {
    if (window.firebase) {
      try {
        const snap = await firebase.database()
          .ref(`matches/${matchId}/colorAssignment`).once('value');
        const ca = snap.val();
        if (ca && ca.creator && ca.opponent) {
          return isCreator ? ca.creator : ca.opponent;
        }
      } catch (e) { /* ignore */ }
    }

    // Compute deterministically from matchId
    const idStr = matchId.replace('HTP-', '');
    let seed = 0;
    for (let i = 0; i < idStr.length; i++) seed += idStr.charCodeAt(i);
    const creatorGetsWhite = (seed % 2 === 0);

    const assignment = {
      creator:  creatorGetsWhite ? 'w' : 'b',
      opponent: creatorGetsWhite ? 'b' : 'w'
    };

    // Write to Firebase so both sides agree (only creator writes)
    if (window.firebase && isCreator) {
      try {
        await firebase.database()
          .ref(`matches/${matchId}/colorAssignment`).set(assignment);
      } catch (e) { /* ignore */ }
    }

    return isCreator ? assignment.creator : assignment.opponent;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. MOVE HISTORY REPLAY
  // ─────────────────────────────────────────────────────────────────────────

  async function replayMoveHistory(matchId, game) {
    if (!window.firebase) return;
    try {
      const snap = await firebase.database()
        .ref(`relay/${matchId}/moves`).orderByChild('ts').once('value');
      const moves = [];
      snap.forEach(child => moves.push(child.val()));
      if (moves.length === 0) return;

      LOG(`Replaying ${moves.length} historical moves for ${matchId}`);
      for (const msg of moves) {
        applyRelayMove(msg, game);
      }
    } catch (e) {
      ERR('replayMoveHistory failed', e);
    }
  }

  function applyRelayMove(msg, game) {
    if (!msg || !msg.type) return;
    if (msg.type !== 'move') return;

    if ((game === 'chess' || !game) && msg.fen && window.chessGame) {
      window.chessGame.load(msg.fen);
    } else if ((game === 'c4' || game === 'connect4') &&
               typeof window.applyC4Move === 'function') {
      window.applyC4Move(msg.col, msg.side);
    } else if ((game === 'ck' || game === 'checkers') &&
               typeof window.applyCkMove === 'function') {
      window.applyCkMove(msg.from, msg.to, msg.side);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. CLOCK MANAGER — shared across all games
  // ─────────────────────────────────────────────────────────────────────────

  // Global clock state
  const clockState = {
    interval: null,
    timeLeft: [0, 0],    // [white/p1 ms, black/p2 ms]
    activeSide: 0,       // 0 = white/p1, 1 = black/p2
    increment: 0,        // seconds to add after each move
    gameOver: false,
    matchId: null,
    game: null
  };

  function initClocks(opts) {
    if (clockState.interval) clearInterval(clockState.interval);

    const timeSec = opts.timeSec || Math.round((opts.minutes || 5) * 60);
    clockState.timeLeft  = [timeSec, timeSec];
    clockState.increment = opts.increment || 0;
    clockState.activeSide = 0; // white/p1 moves first
    clockState.gameOver  = false;
    clockState.matchId   = opts.id;
    clockState.game      = opts.game;

    updateClockDisplay();

    clockState.interval = setInterval(() => {
      if (clockState.gameOver) {
        clearInterval(clockState.interval);
        return;
      }

      clockState.timeLeft[clockState.activeSide]--;

      if (clockState.timeLeft[clockState.activeSide] <= 0) {
        clockState.timeLeft[clockState.activeSide] = 0;
        clockState.gameOver = true;
        clearInterval(clockState.interval);

        // Auto-forfeit: write timeout to Firebase
        const loserSide = clockState.activeSide;
        const winnerSide = loserSide === 0 ? 'b' : 'w';
        if (window.firebase && clockState.matchId) {
          firebase.database().ref(`matches/${clockState.matchId}/result`).set({
            timeout: true,
            winner: winnerSide,
            ts: firebase.database.ServerValue.TIMESTAMP
          }).catch(() => {});
        }
        if (typeof window.handleMatchGameOver === 'function') {
          window.handleMatchGameOver('timeout', winnerSide);
        }
      }

      updateClockDisplay();
    }, 1000);
  }

  /** Call after a move: stop active clock, add increment, switch to opponent */
  function switchClock() {
    if (clockState.gameOver) return;

    // Add increment to the player who just moved
    clockState.timeLeft[clockState.activeSide] += clockState.increment;

    // Switch active side
    clockState.activeSide = clockState.activeSide === 0 ? 1 : 0;
    updateClockDisplay();
  }

  function updateClockDisplay() {
    const topEl = document.getElementById('clock-top');
    const botEl = document.getElementById('clock-bottom');
    if (!topEl || !botEl) return;

    // Top clock = opponent, bottom clock = local player
    // activeSide 0 = white/p1 (bottom when not flipped)
    const isFlipped = window.chessUI && window.chessUI.isFlipped;
    const topIdx = isFlipped ? 0 : 1;
    const botIdx = isFlipped ? 1 : 0;

    topEl.textContent = fmtTime(clockState.timeLeft[topIdx]);
    botEl.textContent = fmtTime(clockState.timeLeft[botIdx]);

    // Active state
    const topActive = clockState.activeSide === topIdx;
    topEl.classList.toggle('active', topActive);
    botEl.classList.toggle('active', !topActive);

    // Danger state (below 30 seconds)
    topEl.classList.toggle('danger', clockState.timeLeft[topIdx] < 30);
    botEl.classList.toggle('danger', clockState.timeLeft[botIdx] < 30);
  }

  /** Apply clock sync from opponent relay message */
  function applyClockSync(msg) {
    if (!msg || !msg.clockSync) return;
    const { w, b } = msg.clockSync;
    if (typeof w === 'number') clockState.timeLeft[0] = w;
    if (typeof b === 'number') clockState.timeLeft[1] = b;
    updateClockDisplay();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7. GAME LAUNCHERS
  // ─────────────────────────────────────────────────────────────────────────

  function launchChessBoard(opts) {
    // Init chess engine
    if (window.Chess && !window.chessGame) {
      window.chessGame = new Chess();
    }

    const isFlipped = opts.side === 'b';

    // Store UI state
    window.chessUI = window.chessUI || {};
    window.chessUI.playerColor = opts.side;
    window.chessUI.isFlipped   = isFlipped;
    window.chessUI.selectedSq  = null;
    window.chessUI.legalMoves  = [];
    window.chessUI.lastMove    = null;

    // Init clocks
    initClocks(opts);

    // Render board
    if (typeof window.initChessBoard === 'function') {
      const container = document.getElementById('chess-board');
      window.initChessBoard(container, {
        side: opts.side,
        matchId: opts.id
      });
    } else if (typeof window.renderChessBoard === 'function') {
      window.renderChessBoard();
    }

    LOG(`Chess board opened for ${opts.id}, you are ${opts.side === 'w' ? 'White' : 'Black'}`);
  }

  function launchConnect4Board(opts) {
    initClocks(opts);

    if (typeof window.initConnect4 === 'function') {
      const container = document.getElementById('c4-board');
      window.initConnect4(container, {
        side: opts.side === 'w' ? 1 : 2,
        matchId: opts.id
      });
    } else if (typeof window.startConnect4Game === 'function') {
      window.startConnect4Game({
        id:    opts.id,
        side:  opts.side === 'w' ? 1 : 2,
        time:  opts.timeSec,
        stake: opts.stake
      });
    }

    LOG(`Connect4 board opened for ${opts.id}`);
  }

  function launchCheckersBoard(opts) {
    initClocks(opts);

    if (typeof window.initCheckers === 'function') {
      const container = document.getElementById('checkers-board');
      window.initCheckers(container, {
        side: opts.side === 'w' ? 'teal' : 'red',
        matchId: opts.id
      });
    } else if (typeof window.startCheckersGame === 'function') {
      window.startCheckersGame({
        id:    opts.id,
        side:  opts.side === 'w' ? 1 : 3,
        time:  opts.timeSec,
        stake: opts.stake
      });
    }

    LOG(`Checkers board opened for ${opts.id}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 8. RELAY HANDLER PATCH — clock sync + board refresh on opponent moves
  // ─────────────────────────────────────────────────────────────────────────

  function patchRelayHandler() {
    const orig = window.handleRelayMessage;
    if (!orig || orig._boardEnginePatched) return;

    window.handleRelayMessage = function (msg) {
      // Apply clock sync from relay message
      if (msg && msg.clockSync) applyClockSync(msg);

      // Switch clock on opponent's move
      if (msg && msg.type === 'move') switchClock();

      orig.call(this, msg);

      // Refresh the board after opponent move
      if (msg && msg.type === 'move') {
        const g = msg.game || clockState.game;
        if (g === 'chess' || !g) {
          setTimeout(() => {
            if (typeof window.renderChessBoard === 'function') window.renderChessBoard();
          }, 50);
        } else if (g === 'c4' || g === 'connect4') {
          // Connect4 board handles its own rendering via applyC4Move
        } else if (g === 'ck' || g === 'checkers') {
          // Checkers board handles its own rendering via applyCkMove
        }
      }

      // Check for game end conditions
      if (msg && msg.type === 'move' && msg.game === 'chess' && window.chessGame) {
        checkChessGameEnd();
      }
    };
    window.handleRelayMessage._boardEnginePatched = true;
    LOG('handleRelayMessage clock-sync patch installed');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 9. GAME END DETECTION
  // ─────────────────────────────────────────────────────────────────────────

  function checkChessGameEnd() {
    const game = window.chessGame;
    if (!game) return;

    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'b' : 'w';
      clockState.gameOver = true;
      triggerGameEnd('checkmate', winner);
    } else if (game.isStalemate()) {
      clockState.gameOver = true;
      triggerGameEnd('stalemate', null);
    } else if (game.isDraw()) {
      clockState.gameOver = true;
      triggerGameEnd('draw', null);
    }
  }

  function triggerGameEnd(reason, winner) {
    if (clockState.interval) clearInterval(clockState.interval);
    clockState.gameOver = true;

    LOG(`Game ended: ${reason}, winner: ${winner || 'none'}`);

    // Write result to Firebase
    if (window.firebase && clockState.matchId) {
      firebase.database().ref(`matches/${clockState.matchId}/result`).set({
        reason,
        winner,
        ts: firebase.database.ServerValue.TIMESTAMP
      }).catch(() => {});
    }

    if (typeof window.handleMatchGameOver === 'function') {
      window.handleMatchGameOver(reason, winner);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 10. DRAW & RESIGN HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  window.offerDraw = function () {
    if (clockState.gameOver) return;

    // Show confirmation modal
    const confirmed = confirm('Offer a draw to your opponent?');
    if (!confirmed) return;

    if (typeof window.relaySend === 'function') {
      window.relaySend({
        type: 'draw-offer',
        matchId: clockState.matchId,
        serverTime: window.firebase ? firebase.database.ServerValue.TIMESTAMP : null,
        clientTime: Date.now()
      });
    }
    LOG('Draw offer sent');
  };

  window.confirmResign = function () {
    if (clockState.gameOver) return;

    const confirmed = confirm('Are you sure you want to resign?');
    if (!confirmed) return;

    const ui = window.chessUI;
    const mySide = ui ? ui.playerColor : 'w';
    const winner = mySide === 'w' ? 'b' : 'w';

    if (typeof window.relaySend === 'function') {
      window.relaySend({
        type: 'resign',
        matchId: clockState.matchId,
        loser: mySide,
        serverTime: window.firebase ? firebase.database.ServerValue.TIMESTAMP : null,
        clientTime: Date.now()
      });
    }

    triggerGameEnd('resignation', winner);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORTS — functions available to other modules
  // ─────────────────────────────────────────────────────────────────────────

  window.htpBoardEngine = {
    openGameBoard,
    switchClock,
    getClockState: () => clockState,
    applyClockSync,
    fmtTime,
    triggerGameEnd,
    checkChessGameEnd
  };

  // Backwards compat
  window.renderChessOverlay = function () {
    if (typeof window.renderChessBoard === 'function') window.renderChessBoard();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // BOOT — install patches once dependencies are ready
  // ─────────────────────────────────────────────────────────────────────────

  function boot() {
    patchJoinAmount();
    patchSendTxAmount();
    patchCreateForCreatorBoard();
    patchJoinForBoard();
    patchRelayHandler();
    LOG('All patches installed');
  }

  let attempts = 0;
  const waitForReady = setInterval(() => {
    attempts++;
    if (window.htpSendTx && window.joinLobbyMatch && window.createMatchWithLobby) {
      clearInterval(waitForReady);
      boot();
    }
    if (attempts > 60) {
      clearInterval(waitForReady);
      ERR('Timeout waiting for dependencies - patching anyway');
      boot();
    }
  }, 100);

  window.addEventListener('htpWasmReady', () => {
    if (!window.htpSendTx || !window.htpSendTx._boardEnginePatched) boot();
  });

  LOG('Board Engine v2 loaded');
})();
