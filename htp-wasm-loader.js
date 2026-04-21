/**
 * htp-wasm-loader.js  —  High Table Protocol  —  v4.0
 *
 * WATCHDOG for Kaspa WASM SDK initialisation.
 *
 * kaspa-wasm-sdk-inline.js is an IIFE that self-initialises — it calls __wbg_init
 * internally, assigns all SDK classes to window, populates window.kaspaSDK, sets
 * window.wasmReady = true, and dispatches 'htpWasmReady'.
 *
 * This file simply waits for that event (or polls window.wasmReady) and confirms
 * success. It does NOT independently try to load or initialise the WASM binary.
 *
 * LOAD ORDER: kaspa-wasm-sdk-inline.js → htp-init.js → THIS → htp-rpc-client.js
 */
(function() {
  'use strict';
  var WASM_TIMEOUT_MS = 60000; // 60 seconds max wait

  function onWasmSuccess() {
    console.log('[HTP WASM] Watchdog: SDK ready — RpcClient:', !!window.kaspaSDK.RpcClient, 'Resolver:', !!window.kaspaSDK.Resolver);
    // htp-init.js's _onWasmReady has an idempotency guard (_wasmReadyFired)
    // so calling it again is safe — it fires callbacks only once.
    if (typeof window._onWasmReady === 'function') {
      window._onWasmReady();
    }
  }

  function onWasmFailed(reason) {
    console.error('[HTP WASM] Watchdog: SDK failed to load —', reason);
    window.wasmReady = false;
    window.dispatchEvent(new Event('htpWasmFailed'));
    // Show a dismissable informational banner (not blocking)
    var banner = document.createElement('div');
    banner.id = 'htp-wasm-error-banner';
    banner.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
      'background:#1d2840;border:1px solid rgba(239,68,68,0.3);color:#e2e8f0;' +
      'padding:12px 24px;border-radius:8px;z-index:9999;font-family:Inter,sans-serif;' +
      'font-size:14px;max-width:500px;text-align:center;cursor:pointer;';
    banner.innerHTML = 'Kaspa WASM SDK unavailable &mdash; blockchain features offline. <u>Dismiss</u>';
    banner.onclick = function() { banner.remove(); };
    document.body.appendChild(banner);
    setTimeout(function() {
      banner.style.transition = 'opacity 0.5s';
      banner.style.opacity = '0';
      setTimeout(function() { if (banner.parentNode) banner.remove(); }, 600);
    }, 20000);
  }

  // Fast path: inline SDK already finished (script ran before us)
  if (window.wasmReady && window.kaspaSDK && window.kaspaSDK.RpcClient) {
    onWasmSuccess();
    return;
  }

  // Listen for inline SDK's completion event
  var resolved = false;
  var timer = setTimeout(function() {
    if (!resolved) {
      resolved = true;
      onWasmFailed('Timeout after ' + (WASM_TIMEOUT_MS / 1000) + 's');
    }
  }, WASM_TIMEOUT_MS);

  window.addEventListener('htpWasmReady', function() {
    if (!resolved) {
      resolved = true;
      clearTimeout(timer);
      onWasmSuccess();
    }
  });

  // Fallback poll in case event fired before this listener was attached
  var pollCount = 0;
  var poll = setInterval(function() {
    pollCount++;
    if (window.wasmReady && window.kaspaSDK && window.kaspaSDK.RpcClient) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        clearInterval(poll);
        onWasmSuccess();
      } else {
        clearInterval(poll);
      }
    } else if (pollCount > 120) { // 120 × 500ms = 60s
      clearInterval(poll);
    }
  }, 500);
})();
