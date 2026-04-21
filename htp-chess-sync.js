// =============================================================
// htp-chess-sync.js  —  HTP Chess Sync Patch v1
// Fixes: board orientation, synchronized Firebase clock,
//        color persistence, payout trigger
// Drop into project root. Add ONE line to index.html:
//   <script src="htp-chess-sync.js"></script>
//   (place it AFTER htp-events.js / htp-events-2.js)
// =============================================================
(function () {
  'use strict';

  // ── helpers ──────────────────────────────────────────────
  function db() { return (typeof firebase !== 'undefined') ? firebase.database() : null; }
  function fmt(ms) {
    if (ms < 0) ms = 0;
    var m = Math.floor(ms / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    return m + ':' + String(s).padStart(2, '0');
  }

  // ── 1. COLOR ASSIGNMENT (Firebase-authoritative) ──────────
  // Written once by creator; joiner reads and takes the other.
  // Stored at: relay/<matchId>/colors  { white: playerId, black: playerId, assigned: true }

  function myPlayerId() {
    return (typeof matchLobby !== 'undefined' && matchLobby.myPlayerId)
      || window._htpPlayerId
      || 'unknown';
  }

  // Creator: atomically write colors once
  function assignColorsAsCreator(matchId) {
    var d = db(); if (!d) return 'white';
    var myColor = Math.random() < 0.5 ? 'white' : 'black';
    var oppColor = myColor === 'white' ? 'black' : 'white';
    var ref = d.ref('relay/' + matchId + '/colors');
    ref.transaction(function (cur) {
      if (cur && cur.assigned) return; // already set — abort
      var obj = { assigned: true };
      obj[myColor]  = myPlayerId();
      obj[oppColor] = 'TBD';
      return obj;
    });
    window._htpMyColor = myColor;
    console.log('[HTP Sync] Creator color:', myColor);
    return myColor;
  }

  // Joiner: take the TBD slot
  function assignColorsAsJoiner(matchId, cb) {
    var d = db(); if (!d) { cb('black'); return; }
    var ref = d.ref('relay/' + matchId + '/colors');
    ref.transaction(function (cur) {
      if (!cur || !cur.assigned) return; // creator hasn't written yet — abort
      var color;
      if (cur.white === 'TBD') { cur.white = myPlayerId(); color = 'white'; }
      else if (cur.black === 'TBD') { cur.black = myPlayerId(); color = 'black'; }
      else return; // both slots filled — abort
      cur._joinerColor = color; // piggyback so we can read it after transaction
      return cur;
    }, function (err, committed, snap) {
      var color = 'black';
      if (!err && committed && snap) {
        var val = snap.val();
        // figure out which color we just wrote
        if (val.white === myPlayerId()) color = 'white';
        else if (val.black === myPlayerId()) color = 'black';
      }
      window._htpMyColor = color;
      console.log('[HTP Sync] Joiner color:', color);
      cb(color);
    });
  }

  // ── 2. BOARD ORIENTATION ─────────────────────────────────
  // Works with the existing chess overlay in htp-events.js.
  // Looks for: #chessboard, .chess-board, [data-board], cg-board

  function applyOrientation(color) {
    if (!color) return;
    // Target every possible board container selector
    var boards = Array.from(document.querySelectorAll(
      '#chessboard, .chess-board, [data-board], cg-board, .cg-board'
    ));

    // Also find the inner board table/grid used by the existing renderer
    var inner = document.getElementById('chessBoardEl') ||
                document.querySelector('.chess-board-inner') ||
                document.querySelector('table.chess');
    if (inner) boards.push(inner);

    if (!boards.length) {
      // Board not in DOM yet — retry after render
      setTimeout(function () { applyOrientation(color); }, 300);
      return;
    }

    boards.forEach(function (b) {
      if (color === 'black') {
        b.style.transform = 'rotate(180deg)';
        b.setAttribute('data-orientation', 'black');
        // Flip individual piece elements so they appear upright
        b.querySelectorAll('.piece, cg-piece, [data-piece], td').forEach(function (p) {
          p.style.transform = 'rotate(180deg)';
        });
      } else {
        b.style.transform = '';
        b.setAttribute('data-orientation', 'white');
        b.querySelectorAll('.piece, cg-piece, [data-piece], td').forEach(function (p) {
          p.style.transform = '';
        });
      }
    });

    // Update the "You (White/Black)" label in the existing overlay
    var labels = document.querySelectorAll('[id*="playerLabel"], [class*="player-label"], .you-label');
    labels.forEach(function (el) {
      if (el.textContent.match(/You/i)) {
        el.textContent = 'You (' + (color === 'white' ? 'White' : 'Black') + ')';
      }
    });

    // Also set chessUI.playerColor so the existing code knows who we are
    if (typeof chessUI !== 'undefined') {
      chessUI.playerColor = color === 'white' ? 'w' : 'b';
    }

    console.log('[HTP Sync] Board orientation applied:', color);
  }

  // ── 3. SYNCHRONIZED CLOCK (Firebase source-of-truth) ─────
  // Written at: relay/<matchId>/clock
  //   { whiteMs, blackMs, activeColor, lastMoveTs }
  // Both clients subscribe and update local display every second.

  var syncClock = {
    matchId: null,
    whiteMs: 600000,
    blackMs: 600000,
    active: 'white',
    lastTs: null,
    _tick: null,
    _unsub: null,

    start: function (matchId, myColor, initialMs) {
      this.matchId = matchId;
      if (initialMs) { this.whiteMs = initialMs; this.blackMs = initialMs; }
      this._subscribe();
      this._startTick();
      console.log('[HTP Sync] Clock started for', matchId, '— initial', initialMs / 60000 | 0, 'min');
    },

    _subscribe: function () {
      var self = this;
      var d = db(); if (!d) return;
      if (self._unsub) self._unsub();
      var ref = d.ref('relay/' + self.matchId + '/clock');
      var fn = ref.on('value', function (snap) {
        var c = snap.val(); if (!c) return;
        self.whiteMs  = c.whiteMs  != null ? c.whiteMs  : self.whiteMs;
        self.blackMs  = c.blackMs  != null ? c.blackMs  : self.blackMs;
        self.active   = c.activeColor || 'white';
        self.lastTs   = c.lastMoveTs  || Date.now();
        self._render();
      });
      self._unsub = function () { ref.off('value', fn); };
    },

    // Called by the move hook after each move
    recordMove: function (movedColor) {
      var now = Date.now();
      if (this.lastTs) {
        var elapsed = now - this.lastTs;
        if (movedColor === 'white') this.whiteMs = Math.max(0, this.whiteMs - elapsed);
        else                        this.blackMs = Math.max(0, this.blackMs - elapsed);
      }
      var next = movedColor === 'white' ? 'black' : 'white';
      this.active  = next;
      this.lastTs  = now;
      var d = db(); if (!d) return;
      d.ref('relay/' + this.matchId + '/clock').set({
        whiteMs:     this.whiteMs,
        blackMs:     this.blackMs,
        activeColor: next,
        lastMoveTs:  now
      });
    },

    _startTick: function () {
      var self = this;
      clearInterval(self._tick);
      self._tick = setInterval(function () {
        if (self.active === 'white') {
          self.whiteMs = Math.max(0, self.whiteMs - 1000);
          if (self.whiteMs === 0) { clearInterval(self._tick); self._onTimeout('white'); }
        } else {
          self.blackMs = Math.max(0, self.blackMs - 1000);
          if (self.blackMs === 0) { clearInterval(self._tick); self._onTimeout('black'); }
        }
        self._render();
      }, 1000);
    },

    _render: function () {
      var wStr = fmt(this.whiteMs);
      var bStr = fmt(this.blackMs);

      // The existing overlay uses these IDs (from chess-visual-v6.html & index.html)
      var selectors = {
        white: ['#clock-white', '.clock-white', '[data-clock="white"]',
                '#chessTimerWhite', '.white-timer', '#timer1'],
        black: ['#clock-black', '.clock-black', '[data-clock="black"]',
                '#chessTimerBlack', '.black-timer', '#timer2']
      };
      selectors.white.forEach(function (s) {
        document.querySelectorAll(s).forEach(function (el) { el.textContent = wStr; });
      });
      selectors.black.forEach(function (s) {
        document.querySelectorAll(s).forEach(function (el) { el.textContent = bStr; });
      });

      // Highlight active clock
      ['white', 'black'].forEach(function (c) {
        var isActive = (c === this.active);
        var els = document.querySelectorAll(
          '[data-clock="' + c + '"], .clock-' + c + ', #clock-' + c
        );
        els.forEach(function (el) {
          el.style.color  = isActive ? '#49e8c2' : '#888';
          el.style.fontWeight = isActive ? '700' : '400';
        });
      }.bind(this));

      // Also patch the existing chessUI timerInterval format if it exists
      if (typeof chessUI !== 'undefined' && chessUI.timerEl) {
        chessUI.timerEl.textContent =
          (this.active === 'white' ? wStr : bStr);
      }
    },

    _onTimeout: function (color) {
      console.log('[HTP Sync] Timeout:', color);
      var winner = color === 'white' ? 'black' : 'white';
      if (typeof handleMatchGameOver === 'function') {
        handleMatchGameOver('timeout', winner);
      } else if (typeof window.handleMatchGameOver === 'function') {
        window.handleMatchGameOver('timeout', winner);
      }
    },

    destroy: function () {
      clearInterval(this._tick);
      if (this._unsub) { this._unsub(); this._unsub = null; }
    }
  };

  window.htpSyncClock = syncClock;

  // ── 4. MOVE RELAY HOOK ────────────────────────────────────
  // Intercepts the existing relaySend to tick the clock on moves.

  var _origRelaySend = null;
  function hookRelaySend() {
    if (typeof window.relaySend !== 'function') {
      setTimeout(hookRelaySend, 500); return;
    }
    if (window.relaySend._syncPatched) return;
    _origRelaySend = window.relaySend;
    window.relaySend = function (msg) {
      _origRelaySend.apply(this, arguments);
      if (msg && msg.type === 'move' && msg.game === 'chess') {
        var col = window._htpMyColor || 'white';
        syncClock.recordMove(col);
      }
    };
    window.relaySend._syncPatched = true;
    console.log('[HTP Sync] relaySend clock hook installed');
  }

  // ── 5. PATCH playMatch / joinLobbyMatch ───────────────────
  // These are the two entry points where a game begins.
  // We inject color assignment + orientation + clock start.

  function patchPlayMatch() {
    var orig = window.playMatch;
    if (!orig || orig._syncPatched) return;
    window.playMatch = function (matchId) {
      var result = orig.apply(this, arguments);
      var match = (typeof matchLobby !== 'undefined')
        ? matchLobby.matches && matchLobby.matches.find(function (m) { return m.id === matchId; })
        : null;
      var isCreator = match && (match.creator === myPlayerId());
      if (isCreator) {
        var color = assignColorsAsCreator(matchId);
        // Apply orientation immediately + after render
        applyOrientation(color);
        setTimeout(function () { applyOrientation(color); }, 600);
        setTimeout(function () { applyOrientation(color); }, 1500);
        // Start clock
        var timeSec = match ? parseFloat(match.timeControl) || 600 : 600;
        syncClock.start(matchId, color, timeSec * 1000);
      } else {
        // Joiner path — read color from Firebase
        assignColorsAsJoiner(matchId, function (color) {
          applyOrientation(color);
          setTimeout(function () { applyOrientation(color); }, 600);
          setTimeout(function () { applyOrientation(color); }, 1500);
          var match2 = (typeof matchLobby !== 'undefined')
            ? matchLobby.matches && matchLobby.matches.find(function (m) { return m.id === matchId; })
            : null;
          var timeSec2 = match2 ? parseFloat(match2.timeControl) || 600 : 600;
          syncClock.start(matchId, color, timeSec2 * 1000);
        });
      }
      hookRelaySend();
      return result;
    };
    window.playMatch._syncPatched = true;
    console.log('[HTP Sync] playMatch patched');
  }

  // Also patch joinLobbyMatch for the post-join game launch
  function patchJoinLobbyMatch() {
    var orig = window.joinLobbyMatch;
    if (!orig || orig._syncPatched) return;
    window.joinLobbyMatch = async function (matchId) {
      var result = await orig.apply(this, arguments);
      // Color assignment handled when playMatch fires (500ms later)
      // But in case playMatch isn't called, handle here too
      setTimeout(function () {
        if (!window._htpMyColor) {
          assignColorsAsJoiner(matchId, function (color) {
            applyOrientation(color);
          });
        }
      }, 1000);
      return result;
    };
    window.joinLobbyMatch._syncPatched = true;
    console.log('[HTP Sync] joinLobbyMatch patched');
  }

  // ── 6. PAYOUT — wire handleMatchGameOver to settlement ────
  // The existing handleMatchGameOver in htp-events.js already calls
  // sendFromEscrow(matchId, walletAddress) for the winner.
  // The issue is it uses a local-only color check. We override it to
  // use the Firebase-synced color so both clients agree on who won.

  function patchHandleMatchGameOver() {
    var orig = window.handleMatchGameOver;
    if (!orig || orig._syncPatched) return;
    window.handleMatchGameOver = async function (reason, winnerColor) {
      // Stop clock
      syncClock.destroy();

      // Use Firebase-synced color
      var myColor = window._htpMyColor || 'white'; // 'white' or 'black'
      // Convert winnerColor from the engine ('w'/'b' or 'white'/'black') to our format
      var winnerStr = (winnerColor === 'w' || winnerColor === 1 || winnerColor === 'white') ? 'white' : 'black';

      // Write result to Firebase idempotently (first write wins — prevents double payout)
      var match = (typeof matchLobby !== 'undefined') ? matchLobby.activeMatch : null;
      var matchId = match ? match.id : window._htpCurrentMatchId;
      if (matchId && db()) {
        var resultRef = db().ref('relay/' + matchId + '/result');
        var snap = await resultRef.once('value');
        if (snap.exists()) {
          console.log('[HTP Sync] Result already recorded — skipping duplicate settlement');
          return;
        }
        await resultRef.set({ winner: winnerStr, reason: reason, ts: Date.now() });
      }

      // Only the winner's client pays out
      var iWon = (winnerStr === myColor);
      if (!iWon && reason !== 'draw' && reason !== 'stalemate') {
        // Call original for UI (game over overlay) but skip payout
        console.log('[HTP Sync] I lost — no payout from my client');
        if (orig) orig.call(this, reason, winnerColor);
        return;
      }

      // Fall through to original for winner (handles sendFromEscrow + overlay)
      if (orig) return orig.call(this, reason, winnerColor);
    };
    window.handleMatchGameOver._syncPatched = true;
    console.log('[HTP Sync] handleMatchGameOver patched — idempotent payout');
  }

  // ── 7. INSTALL ───────────────────────────────────────────
  function install() {
    patchPlayMatch();
    patchJoinLobbyMatch();
    patchHandleMatchGameOver();
    hookRelaySend();
    console.log('[HTP Sync v1] Loaded — orientation ✓ | Firebase clock ✓ | color assign ✓ | idempotent payout ✓');
  }

  // Wait for DOM + window functions to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
  // Re-run after WASM ready (some functions may not exist yet)
  setTimeout(install, 2000);
  setTimeout(install, 5000);
  window.addEventListener('htpWasmReady', install);

})();
