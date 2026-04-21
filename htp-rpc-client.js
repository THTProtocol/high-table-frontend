/**
 * htp-rpc-client.js  —  High Table Protocol  —  v3.0
 *
 * RESPONSIBILITIES:
 *  - Connect to window.HTP_RPC_URL (set by htp-init.js, TN12 or mainnet)
 *  - Reconnect with exponential backoff on disconnect
 *  - Subscribe to virtual-daa-score-changed
 *  - Start UTXO tracking when htp:wallet:connected fires
 *  - Expose window.htpRpc public API used by escrow, settlement, oracle modules
 *
 * LOAD ORDER: after htp-init.js (network config must be set)
 *             after WASM is initialised (_onWasmReady must have fired or will fire)
 */

(function (window) {
  'use strict';

  var SOMPI_PER_KAS    = 100000000n;
  var MAX_BACKOFF_MS   = 30000;
  var BASE_BACKOFF_MS  = 2000;

  /* ══ State ════════════════════════════════════════════════════════════════ */
  var _rpc              = null;
  var _utxoProcessor    = null;
  var _utxoContext      = null;
  var _connected        = false;
  var _daaScore         = 0n;
  var _balanceSompi     = 0n;
  var _trackedAddress   = null;
  var _retryCount       = 0;
  var _retryTimer       = null;
  var _balanceCbs       = new Set();
  var _daaWaiters       = [];  // [{target: bigint, resolve}]

  /* ══ Helpers ══════════════════════════════════════════════════════════════ */
  function sompiToKas(sompi) {
    var s = sompi.toString().padStart(9, '0');
    return parseFloat(s.slice(0, -8) + '.' + s.slice(-8));
  }

  function backoffMs() {
    var delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, _retryCount), MAX_BACKOFF_MS);
    return delay + Math.random() * 1000; // jitter
  }

  function notifyBalance(newSompi) {
    _balanceSompi       = newSompi;
    window.htpBalance   = sompiToKas(newSompi);
    _balanceCbs.forEach(function (cb) {
      try { cb(window.htpBalance, newSompi); } catch (e) {}
    });
    // Dispatch event so UI components can react without polling
    window.dispatchEvent(new CustomEvent('htp:balance:updated', {
      detail: { kas: window.htpBalance, sompi: newSompi.toString(), address: _trackedAddress }
    }));
  }

  function fireDaaWaiters() {
    for (var i = _daaWaiters.length - 1; i >= 0; i--) {
      if (_daaScore >= _daaWaiters[i].target) {
        _daaWaiters[i].resolve(_daaScore);
        _daaWaiters.splice(i, 1);
      }
    }
  }

  /* ══ WASM wait ═══════════════════════════════════════════════════════════ */
  function waitForWasm() {
    return new Promise(function (resolve) {
      // Already ready
      if (window.wasmReady && window.kaspaSDK && window.kaspaSDK.RpcClient) {
        return resolve(window.kaspaSDK);
      }
      // Use the gate from htp-init.js
      if (window.whenWasmReady) {
        window.whenWasmReady(function () {
          resolve(window.kaspaSDK || null);
        });
        return;
      }
      // Fallback poll
      var iv = setInterval(function () {
        if (window.kaspaSDK && window.kaspaSDK.RpcClient) {
          clearInterval(iv);
          resolve(window.kaspaSDK);
        }
      }, 100);
      setTimeout(function () { clearInterval(iv); resolve(null); }, 15000);
    });
  }

  /* ══ UTXO tracking ═════════════════════════════════════════════════════════ */
  async function startUtxoTracking(sdk, address) {
    if (_utxoProcessor) {
      try { await _utxoProcessor.stop(); } catch (e) {}
      _utxoProcessor = null;
      _utxoContext   = null;
    }

    var networkId = window.HTP_NETWORK_ID || 'testnet-12';
    _utxoProcessor = new sdk.UtxoProcessor({ rpc: _rpc, networkId: networkId });
    _utxoContext   = new sdk.UtxoContext({ processor: _utxoProcessor });

    _utxoProcessor.addEventListener('utxo-proc-start', async function () {
      await _utxoContext.trackAddresses([address]);
    });

    _utxoContext.addEventListener('balance', function (e) {
      var mature = BigInt((e.data && e.data.balance && e.data.balance.mature) ? e.data.balance.mature : 0);
      notifyBalance(mature);
    });

    await _utxoProcessor.start();
    window.htpUtxoContext  = _utxoContext;
    window.htpUtxoProc     = _utxoProcessor;
    console.log('[HTPRpc] UTXO tracking started for', address);
  }

  /* ══ Core connect ══════════════════════════════════════════════════════════ */

  // Known stable TN12 wRPC endpoints — tried in order before falling back to Resolver
  var TN12_ENDPOINTS = [
    'wss://tn12.kaspa.stream/wrpc/borsh',
    'wss://tn12-1.kaspa.stream/wrpc/borsh',
    'wss://tn12-2.kaspa.stream/wrpc/borsh'
  ];

  async function initRpc() {
    var sdk = await waitForWasm();
    if (!sdk || !sdk.RpcClient) {
      console.error('[HTPRpc] WASM SDK unavailable — RPC not started');
      return;
    }

    var networkId   = window.HTP_NETWORK_ID || 'testnet-12';
    var rpcEndpoint = window.HTP_RPC_URL || TN12_ENDPOINTS[_retryCount % TN12_ENDPOINTS.length];
    var resolverAlias = 'tn12';

    try {
      // Use direct known-stable endpoint, rotate on retry, Resolver as last resort
      if (sdk.RpcClient && rpcEndpoint) {
        console.log('[HTPRpc] Connecting to', rpcEndpoint, '(', networkId, ')');
        _rpc = new sdk.RpcClient({ url: rpcEndpoint, networkId: networkId });
      } else if (sdk.Resolver) {
        console.log('[HTPRpc] Falling back to Resolver for', networkId);
        _rpc = new sdk.RpcClient({ resolver: new sdk.Resolver(), networkId: networkId });
      } else {
        console.error('[HTPRpc] No RpcClient or Resolver available');
        scheduleRetry();
        return;
      }
    } catch (e) {
      console.error('[HTPRpc] RpcClient construction failed:', e);
      scheduleRetry();
      return;
    }

    // Connected
    _rpc.addEventListener('connect', async function () {
      _connected   = true;
      _retryCount  = 0;
      if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
      console.log('[HTPRpc] Connected →', _rpc.url || rpcEndpoint, '(', networkId, ')');
      window.dispatchEvent(new CustomEvent('htp:rpc:connected', { detail: { url: _rpc.url, networkId: networkId } }));

      try { await _rpc.subscribeVirtualDaaScoreChanged(); } catch (e) {}

      if (_trackedAddress) {
        try { await startUtxoTracking(sdk, _trackedAddress); } catch (e) {}
      }
    });

    // Disconnected — exponential backoff retry
    _rpc.addEventListener('disconnect', function () {
      _connected = false;
      console.warn('[HTPRpc] Disconnected');
      window.dispatchEvent(new Event('htp:rpc:disconnected'));
      scheduleRetry();
    });

    // DAA score heartbeat
    _rpc.addEventListener('virtual-daa-score-changed', function (e) {
      _daaScore         = BigInt(e.data.virtualDaaScore);
      window.htpDaaScore = _daaScore;
      fireDaaWaiters();
    });

    try {
      await _rpc.connect();
    } catch (err) {
      console.error('[HTPRpc] Connect failed:', err.message || err);
      scheduleRetry();
    }
  }

  function scheduleRetry() {
    if (_retryTimer) return;
    var delay = backoffMs();
    _retryCount++;
    console.log('[HTPRpc] Retry #' + _retryCount + ' in ' + Math.round(delay / 1000) + 's');
    _retryTimer = setTimeout(function () {
      _retryTimer = null;
      if (_rpc) {
        try { _rpc.connect().catch(function () { scheduleRetry(); }); } catch (e) { scheduleRetry(); }
      } else {
        initRpc();
      }
    }, delay);
  }

  /* ══ Public API  (window.htpRpc) ═══════════════════════════════════════════════ */
  window.htpRpc = {

    get isConnected()  { return _connected; },
    get daaScore()     { return _daaScore; },
    get networkId()    { return window.HTP_NETWORK_ID || 'testnet-12'; },
    get rpc()          { return _rpc; },
    get utxoContext()  { return _utxoContext; },

    /**
     * Get UTXOs for an address.
     * Returns array of UtxoEntryReference (Kaspa WASM type).
     */
    async getUtxos(address) {
      if (!_rpc || !_connected) throw new Error('[HTPRpc] Not connected');
      var res = await _rpc.getUtxosByAddresses({ addresses: [address] });
      return res.entries || [];
    },

    /**
     * Get balance in sompi (BigInt) for an address.
     */
    async getBalance(address) {
      var entries = await this.getUtxos(address);
      return entries.reduce(function (sum, e) {
        return sum + BigInt(e.utxoEntry.amount);
      }, 0n);
    },

    /**
     * Submit a signed transaction to the network.
     * @param {Transaction} tx  — Kaspa WASM Transaction object (already signed)
     * @returns {string} txId
     */
    async submitTransaction(tx) {
      if (!_rpc || !_connected) throw new Error('[HTPRpc] Not connected');
      var res = await _rpc.submitTransaction({ transaction: tx, allowOrphan: false });
      var txId = res.transactionId || res.txId || res;
      console.log('[HTPRpc] TX submitted:', txId);
      window.dispatchEvent(new CustomEvent('htp:tx:submitted', { detail: { txId: txId } }));
      return txId;
    },

    /**
     * Start tracking balance + UTXOs for a wallet address.
     * Called automatically on htp:wallet:connected event.
     */
    async trackAddress(address) {
      _trackedAddress = address;
      if (!_connected) return;  // will restart on next connect event
      var sdk = await waitForWasm();
      if (sdk) await startUtxoTracking(sdk, address);
    },

    /** Subscribe to balance changes. Returns unsubscribe fn. */
    onBalance: function (cb) {
      _balanceCbs.add(cb);
      return function () { _balanceCbs.delete(cb); };
    },

    /**
     * Resolves when the live DAA score reaches targetDaa.
     * Used by covenant deadline enforcement.
     */
    waitForDaaScore: function (targetDaa) {
      var target = BigInt(targetDaa);
      if (_daaScore >= target) return Promise.resolve(_daaScore);
      return new Promise(function (resolve) {
        _daaWaiters.push({ target: target, resolve: resolve });
      });
    },

    /**
     * Returns the DAA score that will be reached ~secondsFromNow.
     * Kaspa = ~10 blocks/sec ⇒ 1 DAA ≈ 100ms.
     */
    daaScoreAfter: function (secondsFromNow) {
      return _daaScore + BigInt(Math.ceil(secondsFromNow * 10));
    },

    sompiToKas: sompiToKas,

    /**
     * Reconnect to a different endpoint/network (called by htpSetNetwork).
     * Tears down existing connection and reinits with new params.
     */
    async reconnectTo(url, networkId) {
      if (_rpc) {
        try { await _rpc.disconnect(); } catch (e) {}
        _rpc = null;
      }
      _connected = false;
      if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
      _retryCount = 0;
      window.HTP_RPC_URL = url;
      window.HTP_NETWORK_ID = networkId;
      await initRpc();
    },
  };

  // Backwards compat alias used by older modules
  window.HTPRpc = window.htpRpc;

  // Seed globals
  window.htpDaaScore  = 0n;
  window.htpBalance   = 0;

  /* ══ Bootstrap ═══════════════════════════════════════════════════════════════ */

  // Start RPC once WASM is ready (uses whenWasmReady gate from htp-init.js)
  if (window.whenWasmReady) {
    window.whenWasmReady(initRpc);
  } else {
    // htp-init.js not loaded yet — wait for event
    window.addEventListener('htp:wasm:ready', function () { initRpc(); }, { once: true });
  }

  // Auto-track wallet when connected
  window.addEventListener('htp:wallet:connected', function (e) {
    var address = e.detail && e.detail.address;
    if (address && window.htpRpc && window.htpRpc.trackAddress) {
      window.htpRpc.trackAddress(address);
    }
  });

  console.log('[HTPRpc] v3.0 loaded | waiting for WASM...');

})(window);
