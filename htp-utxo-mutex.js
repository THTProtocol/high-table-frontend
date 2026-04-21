/**
 * htp-utxo-mutex.js — HTP UTXO Concurrency Guard v2.0
 *
 * PROBLEM:
 *   Two browser tabs (both players) can race to call settleMatchPayout() for
 *   the same match simultaneously. Both fetch the same UTXOs, both build a TX
 *   spending those UTXOs, and one TX gets rejected by the network as a
 *   double-spend. This wastes fees and causes confusing errors.
 *
 * SOLUTION:
 *   1. Per-matchId async mutex — only one settlement runs at a time per match.
 *      A second caller waits and then short-circuits if the first already settled.
 *   2. Firebase settlement lock (in escrow module) provides the cross-browser guard.
 *   3. This module provides the in-process guard (same browser, multiple calls).
 *
 * LOAD ORDER: before htp-covenant-escrow-v2.js
 */

(function (W) {
  'use strict';

  var MUTEX_TIMEOUT_MS = 30000;  // 30s max hold time — release on hang

  // Per-matchId lock state
  // { [matchId]: { locked: bool, queue: Promise, timer: timeout } }
  var _locks = {};

  // Global serial queue for any UTXO-consuming operation
  var _globalQueue = Promise.resolve();
  var _globalPending = 0;

  /* ══ Per-matchId mutex ═════════════════════════════════════════════════════ */

  /**
   * Acquire the mutex for a given matchId.
   * Returns a release function — MUST be called in a finally block.
   * Auto-releases after MUTEX_TIMEOUT_MS if caller hangs.
   *
   * @param {string} matchId
   * @returns {Promise<function>} release
   */
  function acquireLock(matchId) {
    if (!_locks[matchId]) {
      _locks[matchId] = { queue: Promise.resolve() };
    }

    var lock = _locks[matchId];
    var releaseFn;

    var waitAndLock = lock.queue.then(function () {
      return new Promise(function (resolve) {
        releaseFn = resolve;
      });
    });

    // Next caller waits on waitAndLock
    lock.queue = waitAndLock.catch(function () {});

    // Return a promise that resolves with the release function once we hold the lock
    return new Promise(function (outerResolve) {
      lock.queue = lock.queue.then(function () {
        var timeoutId = setTimeout(function () {
          console.warn('[HTP-MUTEX] Lock timeout for match', matchId, '— force releasing');
          if (releaseFn) releaseFn();
        }, MUTEX_TIMEOUT_MS);

        outerResolve(function release() {
          clearTimeout(timeoutId);
          if (releaseFn) releaseFn();
        });
      });
    });
  }

  /**
   * Run an async function exclusively per matchId.
   * If a concurrent call with the same matchId is already running,
   * this call queues behind it.
   *
   * @param {string}   matchId
   * @param {function} asyncFn  — async () => result
   * @returns {Promise}
   */
  async function withMatchLock(matchId, asyncFn) {
    var release = await acquireLock(matchId);
    try {
      return await asyncFn();
    } finally {
      release();
    }
  }

  /* ══ Global serial queue (for non-matchId UTXO ops) ═══════════════════════════ */

  /**
   * Wrap any async function so concurrent calls are serialised globally.
   * Used for htpSendTx and any raw UTXO submission.
   */
  function serialise(fn) {
    return function () {
      var args    = arguments;
      var context = this;
      _globalPending++;
      var result = _globalQueue.then(function () {
        return fn.apply(context, args);
      });
      _globalQueue = result.catch(function () {}).then(function () {
        _globalPending--;
      });
      return result;
    };
  }

  /* ══ Wrap settleMatchPayout ══════════════════════════════════════════════════ */

  /**
   * Wraps window.settleMatchPayout with the per-matchId mutex.
   * Called once after htp-covenant-escrow-v2.js loads.
   */
  function wrapSettleMatchPayout() {
    if (typeof W.settleMatchPayout !== 'function') return false;
    if (W.settleMatchPayout._mutexWrapped) return true;

    var original = W.settleMatchPayout;
    W.settleMatchPayout = async function (matchId, winnerAddr, isDraw, pA, pB) {
      return withMatchLock(matchId, function () {
        return original(matchId, winnerAddr, isDraw, pA, pB);
      });
    };
    W.settleMatchPayout._mutexWrapped = true;
    W.settleMatchPayout._original     = original;
    console.log('[HTP-MUTEX] settleMatchPayout wrapped with per-matchId lock');
    return true;
  }

  /**
   * Wraps window.htpSendTx (legacy) with the global serial queue.
   */
  function wrapHtpSendTx() {
    if (typeof W.htpSendTx !== 'function') return false;
    if (W.htpSendTx._mutexWrapped) return true;
    var original   = W.htpSendTx;
    W.htpSendTx    = serialise(original);
    W.htpSendTx._mutexWrapped = true;
    W.htpSendTx._original     = original;
    console.log('[HTP-MUTEX] htpSendTx serialised — global UTXO queue active');
    return true;
  }

  /* ══ Bootstrap ══════════════════════════════════════════════════════════════ */

  // Try wrapping immediately (escrow may already be loaded)
  // Then poll for up to 10s to catch async load order variations
  var _attempts = 0;
  var _settled  = false;
  var _poll = setInterval(function () {
    _attempts++;
    var doneSettle  = wrapSettleMatchPayout();
    var doneSendTx  = wrapHtpSendTx();
    if ((doneSettle && doneSendTx) || _attempts > 33) {
      clearInterval(_poll);
      _settled = true;
    }
  }, 300);

  // Also listen for the escrow-loaded custom event as a faster trigger
  W.addEventListener('htp:escrow:loaded', function () {
    wrapSettleMatchPayout();
    wrapHtpSendTx();
    clearInterval(_poll);
  });

  /* ══ Public API ══════════════════════════════════════════════════════════════ */
  W.htpMutex = {
    withMatchLock:    withMatchLock,
    serialise:        serialise,
    getLockState:     function (matchId) { return _locks[matchId] || null; },
    clearLock:        function (matchId) { delete _locks[matchId]; },
  };

  Object.defineProperty(W, 'htpMutexPending', {
    get: function () { return _globalPending; },
    configurable: true,
  });

  console.log('[HTP-MUTEX] v2.0 loaded — per-matchId lock + global serial queue');

})(window);
