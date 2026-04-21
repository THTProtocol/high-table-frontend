/**
 * htp-wasm-loader.js  —  High Table Protocol  —  v5.0 (TN12 Hardened)
 *
 * RESPONSIBILITIES:
 *  - Detect Node.js vs Browser environment
 *  - Load kaspa_bg.wasm correctly in both environments
 *  - Provide initKaspaWasm() async function with retry logic
 *  - Exponential backoff on failure
 *  - Global error handling
 *  - NEVER touch kaspa-wasm-sdk-inline.js (SACRED)
 *
 * LOAD ORDER: kaspa-wasm-sdk-inline.js → htp-init.js → THIS → htp-rpc-client.js
 */
(function(global) {
  'use strict';

  const ENV = (function detectEnv() {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      return 'node';
    }
    if (typeof globalThis !== 'undefined') {
      return 'browser';
    }
    return 'unknown';
  })();

  console.log('[HTP WASM] Environment:', ENV);

  const WASM_TIMEOUT_MS = 60000;
  const MAX_RETRY_ATTEMPTS = 5;

  let _initPromise = null;
  let _retryCount = 0;
  let _globalIsNode = false;

  // Exponential backoff: 1s -> 2s -> 4s -> 8s -> 16s -> 30s max
  function getBackoffDelay(attempt) {
    const base = Math.pow(2, attempt);
    const capped = Math.min(base, 30);
    return capped * 1000 + Math.floor(Math.random() * 1000); // jitter
  }

  // Node.js shim for WebSocket BEFORE WASM init
  function setupNodeShim() {
    if (ENV === 'node' && typeof global.WebSocket === 'undefined') {
      try {
        const { w3cwebsocket } = require('websocket');
        global.WebSocket = w3cwebsocket;
        global.WebSocket.CONNECTING = 0;
        global.WebSocket.OPEN = 1;
        global.WebSocket.CLOSING = 2;
        global.WebSocket.CLOSED = 3;
        console.log('[HTP WASM] WebSocket shim loaded for Node.js');
      } catch (e) {
        console.error('[HTP WASM] Failed to load websocket package:', e);
      }
    }
  }

  function onWasmSuccess() {
    console.log('[HTP WASM] SDK ready — RpcClient:', !!global.kaspaSDK?.RpcClient,
                'Resolver:', !!global.kaspaSDK?.Resolver,
                'Encoding:', !!global.kaspaSDK?.Encoding);

    if (typeof global._onWasmReady === 'function') {
      try {
        global._onWasmReady();
      } catch (e) {
        console.error('[HTP WASM] _onWasmReady callback error:', e);
      }
    }
    
    global.dispatchEvent(new CustomEvent('htp:wasm:ready', { detail: { success: true } }));
  }

  function onWasmFailed(reason) {
    console.error('[HTP WASM] SDK failed to load:', reason);
    global.wasmReady = false;

    if (typeof global.document !== 'undefined' && global.document.body) {
      const banner = global.document.createElement('div');
      banner.id = 'htp-wasm-error-banner';
      banner.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
        'background:#1d2840;border:1px solid rgba(239,68,68,0.3);color:#e2e8f0;' +
        'padding:12px 24px;border-radius:8px;z-index:9999;font-family:Inter,sans-serif;' +
        'font-size:14px;max-width:500px;text-align:center;cursor:pointer;';
      banner.innerHTML = 'Kaspa WASM SDK unavailable — ' + reason + ' <u>Dismiss</u>';
      banner.onclick = function() { banner.remove(); };
      global.document.body.appendChild(banner);
      setTimeout(function() {
        if (banner.parentNode) banner.remove();
      }, 20000);
    }

    global.dispatchEvent(new CustomEvent('htp:wasm:failed', { detail: { reason: reason } }));
  }

  // Wait for WASM with timeout and retry
  async function waitForWasmReady() {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      // Fast path: already ready
      if (global.wasmReady && global.kaspaSDK && global.kaspaSDK.RpcClient) {
        resolve(true);
        return;
      }

      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Timeout after ' + (WASM_TIMEOUT_MS / 1000) + 's'));
        }
      }, WASM_TIMEOUT_MS);

      const checkComplete = () => {
        if (global.wasmReady && global.kaspaSDK && global.kaspaSDK.RpcClient) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(true);
          }
        }
      };

      // Listen for SDK's completion event
      if (global.addEventListener) {
        global.addEventListener('htpWasmReady', function handler() {
          checkComplete();
        }, { once: true });
      }

      // Poll fallback
      const poll = setInterval(() => {
        checkComplete();
      }, 500);

      // Cleanup poll
      setTimeout(() => {
        clearInterval(poll);
      }, WASM_TIMEOUT_MS + 500);
    });
  }

  // Main init function with retry
  async function initKaspaWasm() {
    if (_initPromise) {
      return _initPromise;
    }

    _initPromise = _doInitKaspaWasm().catch(async (err) => {
      _initPromise = null;
      
      if (_retryCount < MAX_RETRY_ATTEMPTS) {
        const delay = getBackoffDelay(_retryCount);
        console.log('[HTP WASM] Retry #' + _retryCount + ' in ' + (delay / 1000) + 's');
        await new Promise(r => setTimeout(r, delay));
        _retryCount++;
        return initKaspaWasm();
      } else {
        onWasmFailed(err.message || 'Max retries exceeded');
        throw err;
      }
    });

    return _initPromise;
  }

  async function _doInitKaspaWasm() {
    // Setup WebSocket shim for Node.js BEFORE loading WASM
    setupNodeShim();

    // Fast path
    if (global.wasmReady && global.kaspaSDK && global.kaspaSDK.RpcClient) {
      console.log('[HTP WASM] WASM already ready');
      onWasmSuccess();
      return global.kaspaSDK;
    }

    console.log('[HTP WASM] Waiting for SDK...');

    try {
      await waitForWasmReady();
      onWasmSuccess();
      _retryCount = 0; // Reset on success
      return global.kaspaSDK;
    } catch (err) {
      throw new Error('WASM initialization failed: ' + err.message);
    }
  }

  // Expose public API
  global.htpWasmLoader = {
    initKaspaWasm: initKaspaWasm,
    get isNode() { return ENV === 'node'; },
    get isBrowser() { return ENV === 'browser'; },
    get isReady() { return !!(global.wasmReady && global.kaspaSDK); },
    get sdk() { return global.kaspaSDK; },
    get retryCount() { return _retryCount; }
  };

  // Auto-init in browser
  if (ENV === 'browser' && global.document) {
    // Wait for DOM ready and then init
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', () => {
        initKaspaWasm().catch(() => {
          // Error handled by retry logic
        });
      });
    } else {
      initKaspaWasm().catch(() => {
        // Error handled by retry logic
      });
    }
  }

  // Global error handling
  if (ENV === 'browser') {
    global.addEventListener('error', (e) => {
      if (e.message && e.message.includes('wasm')) {
        console.error('[HTP WASM] Global WASM error:', e);
      }
    });

    global.addEventListener('unhandledrejection', (e) => {
      if (e.reason && typeof e.reason === 'string' && e.reason.includes('wasm')) {
        console.error('[HTP WASM] Unhandled WASM rejection:', e.reason);
      }
    });
  }

  console.log('[HTP WASM] v5.0 loaded | Waiting for SDK...');

})(typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
