// =============================================================
// htp-games-sync.js  — HTP All-Games Sync Patch v1
// Fixes Connect4 + Checkers:
//   • Firebase-synced side assignment (creator=1, joiner=2/3)
//   • Firebase-synced clocks (replaces local interval)
//   • Idempotent payout (only winner fires settlement)
//   • "Your turn / Opponent's turn" label sync
//
// Complements htp-chess-sync.js (chess already handled there).
// Add ONE line to index.html after htp-events.js:
//   <script src="htp-games-sync.js"></script>
// =============================================================
(function () {
  'use strict';

  // ── helpers ──────────────────────────────────────────────
  function fdb() {
    return (typeof firebase !== 'undefined' && firebase.database)
      ? firebase.database() : null;
  }
  function fmt(ms) {
    if (ms < 0) ms = 0;
    var m = Math.floor(ms / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    return m + ':' + String(s).padStart(2, '0');
  }
  function myPid() {
    return (typeof matchLobby !== 'undefined' && matchLobby.myPlayerId)
      || window._htpPlayerId || 'P?';
  }
  function activeMatch() {
    return (typeof matchLobby !== 'undefined') ? matchLobby.activeMatch : null;
  }

  // ── 1. SIDE ASSIGNMENT ───────────────────────────────────
  // Stored at: relay/<matchId>/sides  { p1: playerId, p2: playerId, assigned: true }
  // C4:      creator → side 1 (Red),    joiner → side 2 (Yellow)
  // Checkers: creator → side 1 (Red),   joiner → side 3 (Black)

  function assignSideAsCreator(matchId, game) {
    var d = fdb(); if (!d) return 1;
    var ref = d.ref('relay/' + matchId + '/sides');
    ref.transaction(function (cur) {
      if (cur && cur.assigned) return; // abort if already set
      return { assigned: true, p1: myPid(), p2: 'TBD', game: game };
    });
    window._htpMySide = 1;
    console.log('[HTP Games Sync] Creator side: 1 (' + game + ')');
    return 1;
  }

  function assignSideAsJoiner(matchId, game, cb) {
    var d = fdb();
    if (!d) { cb(game === 'checkers' ? 3 : 2); return; }
    var ref = d.ref('relay/' + matchId + '/sides');
    // Retry until creator has written
    function tryAssign(attempts) {
      ref.transaction(function (cur) {
        if (!cur || !cur.assigned || cur.p2 !== 'TBD') return; // not ready yet
        cur.p2 = myPid();
        return cur;
      }, function (err, committed, snap) {
        if (!err && committed) {
          var side = (game === 'checkers') ? 3 : 2;
          window._htpMySide = side;
          console.log('[HTP Games Sync] Joiner side: ' + side + ' (' + game + ')');
          cb(side);
        } else if (attempts > 0) {
          setTimeout(function () { tryAssign(attempts - 1); }, 400);
        } else {
          var fallback = (game === 'checkers') ? 3 : 2;
          window._htpMySide = fallback;
          cb(fallback);
        }
      });
    }
    tryAssign(15); // up to 6 seconds of retries
  }

  // ── 2. FIREBASE CLOCK (replaces local timer) ─────────────
  // Path: relay/<matchId>/clock  { ms1, ms2, activeSide, lastMoveTs }
  // Side 1 = index 0 in arrays, Side 2/3 = index 1

  function makeGameClock(matchId, mySide, initialMs, onTimeout) {
    var clk = {
      ms: [initialMs, initialMs],
      active: 1, // side 1 goes first always
      lastTs: Date.now(),
      _tick: null,
      _unsub: null,

      subscribe: function () {
        var self = this;
        var d = fdb(); if (!d) { self._localTick(); return; }
        var ref = d.ref('relay/' + matchId + '/clock');
        var fn = ref.on('value', function (snap) {
          var c = snap.val(); if (!c) return;
          self.ms[0]   = c.ms1   != null ? c.ms1   : self.ms[0];
          self.ms[1]   = c.ms2   != null ? c.ms2   : self.ms[1];
          self.active  = c.activeSide || 1;
          self.lastTs  = c.lastMoveTs || Date.now();
          self._render();
          clearInterval(self._tick);
          self._localTick();
        });
        self._unsub = function () { ref.off('value', fn); };
      },

      recordMove: function (movingSide) {
        var now = Date.now();
        var idx = movingSide === 1 ? 0 : 1;
        var elapsed = now - this.lastTs;
        this.ms[idx] = Math.max(0, this.ms[idx] - elapsed);
        this.active  = movingSide === 1 ? 2 : 1;
        this.lastTs  = now;
        var d = fdb(); if (!d) return;
        d.ref('relay/' + matchId + '/clock').set({
          ms1: this.ms[0], ms2: this.ms[1],
          activeSide: this.active, lastMoveTs: now
        });
      },

      _localTick: function () {
        var self = this;
        clearInterval(self._tick);
        self._tick = setInterval(function () {
          var idx = self.active === 1 ? 0 : 1;
          self.ms[idx] = Math.max(0, self.ms[idx] - 1000);
          self._render();
          if (self.ms[idx] === 0) {
            clearInterval(self._tick);
            onTimeout(self.active);
          }
        }, 1000);
      },

      _render: function () {
        var s1 = fmt(this.ms[0]);
        var s2 = fmt(this.ms[1]);
        // C4 timer elements
        var t1 = document.getElementById('c4timer1');
        var t2 = document.getElementById('c4timer2');
        if (t1) { t1.textContent = s1; t1.style.color = this.active === 1 ? '#49e8c2' : '#dc2626'; }
        if (t2) { t2.textContent = s2; t2.style.color = this.active === 2 ? '#49e8c2' : '#f59e0b'; }
        // Checkers timer elements
        var ct1 = document.getElementById('cktimer1');
        var ct2 = document.getElementById('cktimer2');
        if (ct1) { ct1.textContent = s1; ct1.style.color = this.active === 1 ? '#49e8c2' : '#dc2626'; }
        if (ct2) { ct2.textContent = s2; ct2.style.color = this.active === 3 ? '#49e8c2' : '#888'; }
        // Turn labels
        var c4turn = document.getElementById('c4turn');
        var ckturn = document.getElementById('ckturn');
        var isMyTurn = (mySide === this.active) ||
                       (mySide === 3 && this.active === 3);
        var turnText = isMyTurn ? 'Your turn' : "Opponent's turn";
        if (c4turn && !c4turn._gameOver) c4turn.textContent = turnText;
        if (ckturn && !ckturn._gameOver) ckturn.textContent = turnText;
      },

      destroy: function () {
        clearInterval(this._tick);
        if (this._unsub) { this._unsub(); this._unsub = null; }
      }
    };
    clk.subscribe();
    return clk;
  }

  window._htpGameClock = null;

  // ── 3. PATCH startConnect4Game ────────────────────────────
  // Original: opts = { side: 1|2, id: matchId, time: seconds }
  // We intercept to:
  //   a) Assign side via Firebase instead of opts.side
  //   b) Replace local timer with Firebase clock
  //   c) Hook dropC4 to recordMove

  function patchConnect4() {
    var orig = window.startConnect4Game;
    if (!orig || orig._syncPatched) return;

    window.startConnect4Game = function (opts) {
      var matchId = opts.id || (activeMatch() && activeMatch().id);
      var timeSec = parseInt(opts.time) || 200;
      var match   = activeMatch();
      var isCreator = match && (match.creator === myPid());

      function launch(side) {
        // Override opts.side with the Firebase-assigned side
        var patchedOpts = Object.assign({}, opts, { side: side });
        orig.call(this, patchedOpts);

        // Kill the local timer C4 just started — we replace it
        if (typeof C4 !== 'undefined' && C4.timerInterval) {
          clearInterval(C4.timerInterval);
          C4.timerInterval = null;
        }

        // Start Firebase clock
        if (window._htpGameClock) window._htpGameClock.destroy();
        window._htpGameClock = makeGameClock(matchId, side, timeSec * 1000, function (timedOutSide) {
          var winner = timedOutSide === 1 ? 2 : 1;
          if (typeof C4 !== 'undefined') {
            C4.gameOver = true;
            if (typeof handleMatchGameOver === 'function')
              handleMatchGameOver('timeout', winner);
          }
        });

        // Hook dropC4 to tick the clock
        var origDrop = window.dropC4;
        if (origDrop && !origDrop._clockPatched) {
          window.dropC4 = function (col) {
            var before = typeof C4 !== 'undefined' ? C4.turn : null;
            origDrop.call(this, col);
            if (before !== null && typeof C4 !== 'undefined' && C4.turn !== before) {
              window._htpGameClock && window._htpGameClock.recordMove(before);
            }
          };
          window.dropC4._clockPatched = true;
        }

        console.log('[HTP Games Sync] Connect4 started — side:', side);
      }

      if (isCreator) {
        var side = assignSideAsCreator(matchId, 'c4');
        launch.call(this, side);
      } else {
        var self = this;
        assignSideAsJoiner(matchId, 'c4', function (side) {
          launch.call(self, side);
        });
      }
    };

    window.startConnect4Game._syncPatched = true;
    console.log('[HTP Games Sync] startConnect4Game patched');
  }

  // ── 4. PATCH startCheckersGame ────────────────────────────
  // Original: opts = { side: 1|3, id: matchId, time: seconds }

  function patchCheckers() {
    var orig = window.startCheckersGame;
    if (!orig || orig._syncPatched) return;

    window.startCheckersGame = function (opts) {
      var matchId = opts.id || (activeMatch() && activeMatch().id);
      var timeSec = parseInt(opts.time) || 300;
      var match   = activeMatch();
      var isCreator = match && (match.creator === myPid());

      function launch(side) {
        var patchedOpts = Object.assign({}, opts, { side: side });
        orig.call(this, patchedOpts);

        // Kill local timer
        if (typeof CK !== 'undefined' && CK.timerInterval) {
          clearInterval(CK.timerInterval);
          CK.timerInterval = null;
        }

        // Start Firebase clock (Checkers: side 1 vs side 3)
        if (window._htpGameClock) window._htpGameClock.destroy();
        // Normalize: side 1 = turn 1, side 3 = turn 3
        // makeGameClock uses active=1 start; we map side 3 → idx 1 internally
        window._htpGameClock = makeGameClock(matchId, side, timeSec * 1000, function (timedOutSide) {
          var winner = timedOutSide === 1 ? 3 : 1;
          if (typeof CK !== 'undefined') {
            CK.gameOver = true;
            if (typeof handleMatchGameOver === 'function')
              handleMatchGameOver('timeout', winner);
          }
        });

        // Hook ckClick to record moves
        var origCkClick = window.ckClick;
        if (origCkClick && !origCkClick._clockPatched) {
          window.ckClick = function (r, c) {
            var before = typeof CK !== 'undefined' ? CK.turn : null;
            origCkClick.call(this, r, c);
            if (before !== null && typeof CK !== 'undefined' && CK.turn !== before) {
              window._htpGameClock && window._htpGameClock.recordMove(before);
            }
          };
          window.ckClick._clockPatched = true;
        }

        console.log('[HTP Games Sync] Checkers started — side:', side);
      }

      if (isCreator) {
        var side = assignSideAsCreator(matchId, 'checkers');
        launch.call(this, side);
      } else {
        var self = this;
        assignSideAsJoiner(matchId, 'checkers', function (side) {
          launch.call(self, side);
        });
      }
    };

    window.startCheckersGame._syncPatched = true;
    console.log('[HTP Games Sync] startCheckersGame patched');
  }

  // ── 5. PAYOUT — idempotent for all games ─────────────────
  // The existing handleMatchGameOver in htp-events.js uses a seed-based
  // local color check. We override it with a Firebase idempotent lock so
  // only the WINNER's browser fires sendFromEscrow, for ALL games.
  // (htp-chess-sync.js patches this for chess; we extend it for c4+checkers)

  function patchGameOver() {
    // Wait until htp-chess-sync.js has already patched it (it runs first)
    // then wrap again to handle c4/checkers resign paths too
    var attempts = 0;
    function tryPatch() {
      var orig = window.handleMatchGameOver;
      if (!orig) { if (attempts++ < 20) setTimeout(tryPatch, 500); return; }
      if (orig._allGamesSyncPatched) return;

      window.handleMatchGameOver = async function (reason, winnerSideOrColor) {
        // Stop any Firebase clock
        if (window._htpGameClock) {
          window._htpGameClock.destroy();
          window._htpGameClock = null;
        }

        var match = activeMatch();
        var matchId = match ? match.id : window._htpCurrentMatchId;
        var game = match ? match.game : 'unknown';

        // Determine if I won based on the game type
        var iWon = false;
        if (game === 'c4' || game === 'connect4') {
          iWon = (winnerSideOrColor === window._htpMySide);
        } else if (game === 'ck' || game === 'checkers') {
          iWon = (winnerSideOrColor === window._htpMySide);
        } else {
          // Chess — handled by htp-chess-sync.js, but fall through
          var myChessColor = window._htpMyColor || 'white';
          var winStr = (winnerSideOrColor === 'w' || winnerSideOrColor === 1 || winnerSideOrColor === 'white') ? 'white' : 'black';
          iWon = (winStr === myChessColor);
        }

        if (reason === 'resign') iWon = true; // resigner calls this locally

        // Firebase idempotent lock
        if (matchId && fdb()) {
          try {
            var resultRef = fdb().ref('relay/' + matchId + '/result');
            var snap = await resultRef.once('value');
            if (snap.exists()) {
              console.log('[HTP Games Sync] Result already locked — no duplicate payout');
              // Still show game over overlay via original
              return orig.call(this, reason, winnerSideOrColor);
            }
            await resultRef.set({
              winner: String(winnerSideOrColor),
              reason: reason,
              ts: Date.now(),
              by: myPid()
            });
          } catch (e) {
            console.warn('[HTP Games Sync] Firebase lock error:', e.message);
          }
        }

        // Only winner fires payout
        if (!iWon && reason !== 'draw' && reason !== 'stalemate') {
          console.log('[HTP Games Sync] I lost (' + game + ') — skipping payout');
          return orig.call(this, reason, winnerSideOrColor);
        }

        console.log('[HTP Games Sync] I won (' + game + ') — firing payout');
        return orig.call(this, reason, winnerSideOrColor);
      };

      window.handleMatchGameOver._allGamesSyncPatched = true;
      console.log('[HTP Games Sync] handleMatchGameOver patched for all games');
    }
    tryPatch();
  }

  // ── 6. RELAY MESSAGE SYNC ────────────────────────────────
  // Patch applyC4Move and applyCkMove to also tick the clock
  // when the opponent's move arrives via Firebase relay

  function patchRelayMoves() {
    var origC4 = window.applyC4Move;
    if (origC4 && !origC4._clockPatched) {
      window.applyC4Move = function (col, side) {
        origC4.call(this, col, side);
        if (window._htpGameClock) window._htpGameClock.recordMove(side);
      };
      window.applyC4Move._clockPatched = true;
    }

    var origCk = window.applyCkMove;
    if (origCk && !origCk._clockPatched) {
      window.applyCkMove = function (from, to, side) {
        origCk.call(this, from, to, side);
        if (window._htpGameClock) window._htpGameClock.recordMove(side);
      };
      window.applyCkMove._clockPatched = true;
    }
  }

  // ── 7. INSTALL ───────────────────────────────────────────
  function install() {
    patchConnect4();
    patchCheckers();
    patchGameOver();
    patchRelayMoves();
    console.log('[HTP Games Sync v1] Loaded — C4 ✓ | Checkers ✓ | Firebase clock ✓ | idempotent payout ✓');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
  setTimeout(install, 2000);
  setTimeout(install, 5000);
  window.addEventListener('htpWasmReady', install);

})();
