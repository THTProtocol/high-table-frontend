/**
 * htp-match-deadline.js — DAA-score based match timing (replaces wall-clock)
 *
 * Why DAA score instead of Date.now():
 *   - DAA score increments ~10x/sec on Kaspa mainnet
 *   - It is chain-verified — no client can fake it
 *   - A DAA delta is fully reproducible by any node — safe for covenant expiry
 *   - Disconnected clients can't cheat time by pausing system clock
 *
 * API:
 *   HTPDeadline.create(matchId, options)  → deadline object
 *   HTPDeadline.check(matchId)            → { expired, remaining, daaRemaining }
 *   HTPDeadline.onExpiry(matchId, cb)     → calls cb when deadline is hit on-chain
 *   HTPDeadline.cancel(matchId)
 *   HTPDeadline.serialize(matchId)        → storable object (for Firebase)
 *   HTPDeadline.restore(data)             → re-registers from Firebase snapshot
 *
 * Load order: AFTER htp-rpc-client.js
 */

(function () {
  'use strict';

  const DAA_PER_SEC = 10n;   // ~10 DAA ticks per second on Kaspa mainnet

  // matchId → { deadlineDaa, expiryCallbacks, cancelled, label }
  const deadlines = new Map();

  function nowDaa() {
    return window.htpDaaScore || 0n;
  }

  function secondsToDaa(seconds) {
    return BigInt(Math.ceil(seconds)) * DAA_PER_SEC;
  }

  function daaToSeconds(daa) {
    return Number(daa) / Number(DAA_PER_SEC);
  }

  /**
   * Create a deadline for a match.
   * @param {string} matchId
   * @param {object} opts
   *   opts.seconds     — duration from now in seconds  (mutually exclusive with opts.daaScore)
   *   opts.daaScore    — absolute target DAA score     (use for covenant-anchored deadlines)
   *   opts.label       — human label (e.g. 'move', 'match', 'stake')
   */
  function create(matchId, opts = {}) {
    const currentDaa = nowDaa();
    let deadlineDaa;

    if (opts.daaScore !== undefined) {
      deadlineDaa = BigInt(opts.daaScore);
    } else if (opts.seconds !== undefined) {
      deadlineDaa = currentDaa + secondsToDaa(opts.seconds);
    } else {
      throw new Error('[HTPDeadline] Provide opts.seconds or opts.daaScore');
    }

    const entry = {
      matchId,
      deadlineDaa,
      label: opts.label || 'match',
      startDaa: currentDaa,
      expiryCallbacks: new Set(),
      cancelled: false,
    };

    deadlines.set(matchId, entry);

    // Register waiter with HTPRpc
    if (window.HTPRpc && window.HTPRpc.waitForDaaScore) {
      window.HTPRpc.waitForDaaScore(deadlineDaa).then(() => {
        if (!entry.cancelled) {
          entry.expiryCallbacks.forEach(cb => {
            try { cb({ matchId, deadlineDaa, label: entry.label }); } catch(e) {}
          });
          window.dispatchEvent(new CustomEvent('htp:deadline:expired', {
            detail: { matchId, deadlineDaa: deadlineDaa.toString(), label: entry.label }
          }));
        }
      });
    }

    console.log(`[HTPDeadline] ${matchId} (${entry.label}) → DAA ${deadlineDaa} (~${daaToSeconds(deadlineDaa - currentDaa).toFixed(1)}s from now)`);
    return { matchId, deadlineDaa: deadlineDaa.toString(), label: entry.label };
  }

  function check(matchId) {
    const entry = deadlines.get(matchId);
    if (!entry) return null;
    const current = nowDaa();
    const daaRemaining = entry.deadlineDaa > current ? entry.deadlineDaa - current : 0n;
    return {
      matchId,
      expired: current >= entry.deadlineDaa,
      cancelled: entry.cancelled,
      deadlineDaa: entry.deadlineDaa.toString(),
      currentDaa: current.toString(),
      daaRemaining: daaRemaining.toString(),
      secondsRemaining: daaToSeconds(daaRemaining),
    };
  }

  function onExpiry(matchId, cb) {
    const entry = deadlines.get(matchId);
    if (!entry) throw new Error(`[HTPDeadline] Unknown matchId: ${matchId}`);
    entry.expiryCallbacks.add(cb);
    return () => entry.expiryCallbacks.delete(cb);
  }

  function cancel(matchId) {
    const entry = deadlines.get(matchId);
    if (entry) entry.cancelled = true;
  }

  function serialize(matchId) {
    const entry = deadlines.get(matchId);
    if (!entry) return null;
    return {
      matchId: entry.matchId,
      deadlineDaa: entry.deadlineDaa.toString(),
      startDaa: entry.startDaa.toString(),
      label: entry.label,
    };
  }

  function restore(data) {
    if (!data || !data.matchId || !data.deadlineDaa) return;
    const currentDaa = nowDaa();
    const deadlineDaa = BigInt(data.deadlineDaa);

    const entry = {
      matchId: data.matchId,
      deadlineDaa,
      startDaa: BigInt(data.startDaa || '0'),
      label: data.label || 'match',
      expiryCallbacks: new Set(),
      cancelled: false,
    };

    deadlines.set(data.matchId, entry);

    if (currentDaa < deadlineDaa && window.HTPRpc) {
      window.HTPRpc.waitForDaaScore(deadlineDaa).then(() => {
        if (!entry.cancelled) {
          entry.expiryCallbacks.forEach(cb => {
            try { cb({ matchId: data.matchId, deadlineDaa, label: entry.label }); } catch(e) {}
          });
          window.dispatchEvent(new CustomEvent('htp:deadline:expired', {
            detail: { matchId: data.matchId, deadlineDaa: deadlineDaa.toString() }
          }));
        }
      });
      console.log(`[HTPDeadline] Restored ${data.matchId} — ${daaToSeconds(deadlineDaa - currentDaa).toFixed(1)}s remaining`);
    } else {
      console.warn(`[HTPDeadline] Restored ${data.matchId} — already expired`);
    }
  }

  window.HTPDeadline = { create, check, onExpiry, cancel, serialize, restore, nowDaa, daaToSeconds, secondsToDaa };
})();
