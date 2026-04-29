// =============================================================
// htp-games-sync.js  — HTP All-Games Sync Patch v2
// Fixes Connect4 + Checkers:
//   • Firebase-synced side assignment (creator=1, joiner=2/3)
//   • Firebase-synced clocks (replaces local interval)
//   • Idempotent payout (only winner fires settlement)
//   • "Your turn / Opponent's turn" label sync
//
// FIX (v2): patchRelayMoves now polls until applyC4Move / applyCkMove
//           are defined (they are registered inside startConnect4Game /
//           startCheckersGame, which run later). The old approach called
//           patchRelayMoves at install-time when the functions did not
//           yet exist, so the clock-tick hook was never applied.
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
  function assignSideAsCreator(matchId, game) {
    var d = fdb(); if (!d) return 1;
    var ref = d.ref('relay/' + matchId + '/sides');
    ref.transaction(function (cur) {
      if (cur && cur.assigned) return;
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
    function tryAssign(attempts) {
      ref.transaction(function (cur) {
        if (!cur || !cur.assigned || cur.p2 !== 'TBD') return;
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
    tryAssign(15); // up to 6 seconds
  }

  // ── 2. FIREBASE CLOCK ────────────────────────────────────
  function makeGameClock(matchId, mySide, initialMs, onTimeout) {
    var clk = {
      ms: [initialMs, initialMs],
      active: 1,
      lastTs: Date.now(),
      _tick: null,
      _unsub: null,

      subscribe: function () {
        var self = this;
        var d = fdb(); if (!d) { self._localTick(); return; }
        var ref = d.ref('relay/' + matchId + '/clock');
        var fn = ref.on('value', function (snap) {
          var c = snap.val(); if (!c) return;
          self.ms[0]  = c.ms1        != null ? c.ms1        : self.ms[0];
          self.ms[1]  = c.ms2        != null ? c.ms2        : self.ms[1];
          self.active = c.activeSide || 1;
          self.lastTs = c.lastMoveTs || Date.now();
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
        var t1 = document.getElementById('c4timer1');
        var t2 = document.getElementById('c4timer2');
        if (t1) { t1.textContent = s1; t1.style.color = this.active === 1 ? '#49e8c2' : '#dc2626'; }
        if (t2) { t2.textContent = s2; t2.style.color = this.active === 2 ? '#49e8c2' : '#f59e0b'; }
        var ct1 = document.getElementById('cktimer1');
        var ct2 = document.getElementById('cktimer2');
        if (ct1) { ct1.textContent = s1; ct1.style.color = this.active === 1 ? '#49e8c2' : '#dc2626'; }
        if (ct2) { ct2.textContent = s2; ct2.style.color = this.active === 3 ? '#49e8c2' : '#888'; }
        var c4turn = document.getElementById('c4turn');
        var ckturn = document.getElementById('ckturn');
        var isMyTurn = (mySide === this.active) || (mySide === 3 && this.active === 3);
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
  function patchConnect4() {
    var orig = window.startConnect4Game;
    if (!orig || orig._syncPatched) return;

    window.startConnect4Game = function (opts) {
      var matchId   = opts.id || (activeMatch() && activeMatch().id);
      var timeSec   = parseInt(opts.time) || 200;
      var match     = activeMatch();
      var isCreator = match && (match.creator === myPid());

      function launch(side) {
        var patchedOpts = Object.assign({}, opts, { side: side });
        orig.call(this, patchedOpts);

        if (typeof C4 !== 'undefined' && C4.timerInterval) {
          clearInterval(C4.timerInterval);
          C4.timerInterval = null;
        }

        if (window._htpGameClock) window._htpGameClock.destroy();
        window._htpGameClock = makeGameClock(matchId, side, timeSec * 1000, function (timedOutSide) {
          var winner = timedOutSide === 1 ? 2 : 1;
          if (typeof C4 !== 'undefined') {
            C4.gameOver = true;
            if (typeof handleMatchGameOver === 'function')
              handleMatchGameOver('timeout', winner);
          }
        });

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

        // FIX: hook relay functions NOW that we know game is starting
        _patchRelayC4();
        console.log('[HTP Games Sync] Connect4 started — side:', side);
      }

      if (isCreator) {
        launch.call(this, assignSideAsCreator(matchId, 'c4'));
      } else {
        var self = this;
        assignSideAsJoiner(matchId, 'c4', function (side) { launch.call(self, side); });
      }
    };
    window.startConnect4Game._syncPatched = true;
    console.log('[HTP Games Sync] startConnect4Game patched');
  }

  // ── 4. PATCH startCheckersGame ────────────────────────────
  function patchCheckers() {
    var orig = window.startCheckersGame;
    if (!orig || orig._syncPatched) return;

    window.startCheckersGame = function (opts) {
      var matchId   = opts.id || (activeMatch() && activeMatch().id);
      var timeSec   = parseInt(opts.time) || 300;
      var match     = activeMatch();
      var isCreator = match && (match.creator === myPid());

      function launch(side) {
        var patchedOpts = Object.assign({}, opts, { side: side });
        orig.call(this, patchedOpts);

        if (typeof CK !== 'undefined' && CK.timerInterval) {
          clearInterval(CK.timerInterval);
          CK.timerInterval = null;
        }

        if (window._htpGameClock) window._htpGameClock.destroy();
        window._htpGameClock = makeGameClock(matchId, side, timeSec * 1000, function (timedOutSide) {
          var winner = timedOutSide === 1 ? 3 : 1;
          if (typeof CK !== 'undefined') {
            CK.gameOver = true;
            if (typeof handleMatchGameOver === 'function')
              handleMatchGameOver('timeout', winner);
          }
        });

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

        // FIX: hook relay functions NOW
        _patchRelayCk();
        console.log('[HTP Games Sync] Checkers started — side:', side);
      }

      if (isCreator) {
        launch.call(this, assignSideAsCreator(matchId, 'checkers'));
      } else {
        var self = this;
        assignSideAsJoiner(matchId, 'checkers', function (side) { launch.call(self, side); });
      }
    };
    window.startCheckersGame._syncPatched = true;
    console.log('[HTP Games Sync] startCheckersGame patched');
  }

  // ── 5. RELAY MOVE PATCHES (deferred, game-specific) ──────
  // FIX: These are now called from inside the launch() closures above,
  // AFTER the game module has registered applyC4Move / applyCkMove.
  // Previously they were called at install-time (before the game started),
  // so window.applyC4Move was undefined and the hook was silently skipped.

  function _patchRelayC4() {
    var origC4 = window.applyC4Move;
    if (!origC4 || origC4._clockPatched) return;
    window.applyC4Move = function (col, side) {
      origC4.call(this, col, side);
      if (window._htpGameClock) window._htpGameClock.recordMove(side);
    };
    window.applyC4Move._clockPatched = true;
    console.log('[HTP Games Sync] applyC4Move clock-patched');
  }

  function _patchRelayCk() {
    var origCk = window.applyCkMove;
    if (!origCk || origCk._clockPatched) return;
    window.applyCkMove = function (from, to, side) {
      origCk.call(this, from, to, side);
      if (window._htpGameClock) window._htpGameClock.recordMove(side);
    };
    window.applyCkMove._clockPatched = true;
    console.log('[HTP Games Sync] applyCkMove clock-patched');
  }

  // ── 6. PAYOUT ─────────────────────────────────────────────
  function patchGameOver() {
    var attempts = 0;
    function tryPatch() {
      var orig = window.handleMatchGameOver;
      if (!orig) { if (attempts++ < 20) setTimeout(tryPatch, 500); return; }
      if (orig._allGamesSyncPatched) return;

      window.handleMatchGameOver = async function (reason, winnerSideOrColor) {
        if (window._htpGameClock) {
          window._htpGameClock.destroy();
          window._htpGameClock = null;
        }

        var match   = activeMatch();
        var matchId = match ? match.id : window._htpCurrentMatchId;
        var game    = match ? match.game : 'unknown';

        var iWon = false;
        if (game === 'c4' || game === 'connect4') {
          iWon = (winnerSideOrColor === window._htpMySide);
        } else if (game === 'ck' || game === 'checkers') {
          iWon = (winnerSideOrColor === window._htpMySide);
        } else {
          var myChessColor = window._htpMyColor || 'white';
          var winStr = (winnerSideOrColor === 'w' || winnerSideOrColor === 1 || winnerSideOrColor === 'white') ? 'white' : 'black';
          iWon = (winStr === myChessColor);
        }

        if (reason === 'resign') iWon = true;

        if (matchId && fdb()) {
          try {
            var resultRef = fdb().ref('relay/' + matchId + '/result');
            var snap = await resultRef.once('value');
            if (snap.exists()) {
              console.log('[HTP Games Sync] Result already locked — no duplicate payout');
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

  // ── 7. INSTALL ───────────────────────────────────────────
  // patchRelayMoves() is intentionally NOT called here anymore.
  // It is called from inside launch() in patchConnect4/patchCheckers,
  // which runs after the game registers applyC4Move/applyCkMove.
  function install() {
    patchConnect4();
    patchCheckers();
    patchGameOver();
    console.log('[HTP Games Sync v2] Loaded — C4 ✓ | Checkers ✓ | Firebase clock ✓ | idempotent payout ✓ | relay-patch deferred ✓');
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
