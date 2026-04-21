/**
 * htp-init.js  —  High Table Protocol  —  v3.0
 *
 * RESPONSIBILITIES:
 *  1. Detect TN12 vs mainnet → set window.HTP_NETWORK + window.activeNet  (ONE place, done first)
 *  2. WASM boot gate  —  unlock all .wasm-gate elements + fire _onWasmReady() callbacks
 *  3. Identity / seat resolution
 *  4. Wallet auto-connect (KasWare → KaspaWallet → localStorage)
 *  5. Board CSS injection
 *
 * FULL TRUSTLESS MODEL:
 *  - Escrow keypair is generated client-side and NEVER leaves the browser.
 *  - Firebase is coordination-only (match state, oracle attestation).
 *  - Oracle signs the result; the winner's browser sends the settlement TX.
 *  - window.HTP_NETWORK / window.activeNet drives ALL on-chain calls.
 *    Switching TN12 ↔ mainnet is ONE place: the NETWORK_MAP below.
 */

(function (window) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
   * 1.  NETWORK DETECTION  (runs synchronously, before anything else)
   * ═══════════════════════════════════════════════════════════════════════════ */

  var NETWORK_MAP = {
    mainnet: {
      prefix:      'kaspa',
      networkId:   'mainnet',
      resolverAlias: 'mainnet',  // Use Kaspa Resolver for load-balancing
      useResolver: true,
      explorerTx:  'https://explorer.kaspa.org/txs/',
    },
    tn12: {
      prefix:      'kaspatest',
      networkId:   'testnet-12',
      resolverAlias: 'tn12',  // Use Kaspa Resolver for TN12 load-balancing
      useResolver: true,
      explorerTx:  'https://tn12.kaspa.stream/txs/',
    },
  };

  function detectNetwork() {
    // Priority order: URL param → localStorage override → default (tn12 for now)
    var param = (new URLSearchParams(window.location.search)).get('net');
    var stored = null;
    try { stored = localStorage.getItem('htp_network'); } catch (e) {}
    var key = (param || stored || 'tn12').toLowerCase();
    if (!NETWORK_MAP[key]) key = 'tn12';
    var net = NETWORK_MAP[key];
    // Expose globally — every other module reads these
    window.HTP_NETWORK       = key;                   // 'tn12' | 'mainnet'
    window.activeNet         = net;                   // full config object
    window.HTP_RESOLVER_ALIAS= net.resolverAlias;     // 'tn12' or 'mainnet' for Kaspa Resolver
    window.HTP_USE_RESOLVER  = net.useResolver;       // true = use Resolver, false = direct endpoint
    window.HTP_PREFIX        = net.prefix;
    window.HTP_NETWORK_ID    = net.networkId;
    window.HTP_EXPLORER      = net.explorerTx;
    try { localStorage.setItem('htp_network', key); } catch (e) {}
    console.log('[HTP Init] Network:', key, '| Resolver:', net.resolverAlias, '| Using Resolver:', net.useResolver);
    return net;
  }

  // Run immediately — synchronous
  detectNetwork();

  /* ═══════════════════════════════════════════════════════════════════════════
   * 2.  WASM BOOT GATE
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * The inline init in index.html (or external loader) calls
   * window._onWasmReady() once the WASM module is initialised.
   *
   * Pattern:
   *   - Before WASM ready: all .wasm-gate elements are disabled + dimmed.
   *   - After: they are enabled, opacity restored, and any queued callbacks fire.
   */

  var _wasmReadyCallbacks = [];
  var _wasmReadyFired     = false;
  var _wasmWarnTimer      = null;

  function _unlockGates() {
    document.querySelectorAll('.wasm-gate').forEach(function (el) {
      el.disabled      = false;
      el.style.opacity = '1';
      el.title         = '';
    });
  }

  function _onWasmReady() {
    if (_wasmReadyFired) return;
    
    // Clear any pending timeouts
    if (typeof _wasmTimeoutHandle !== 'undefined') {
      clearTimeout(_wasmTimeoutHandle);
    }
    
    _wasmReadyFired      = true;
    window.wasmReady     = true;
    window.kaspaWasmReady = function () { return true; };
    _unlockGates();
    if (_wasmWarnTimer) {
      clearTimeout(_wasmWarnTimer);
      _wasmWarnTimer = null;
    }
    var oldBanner = document.getElementById('htp-wasm-warning');
    if (oldBanner) oldBanner.remove();
    console.log('[HTP Init] WASM ready — gates unlocked ✓');
    _wasmReadyCallbacks.forEach(function (cb) {
      try { cb(); } catch (e) { console.warn('[HTP Init] wasmReady callback error', e); }
    });
    _wasmReadyCallbacks = [];
    window.dispatchEvent(new CustomEvent('htp:wasm:ready'));
  }

  function whenWasmReady(cb) {
    if (_wasmReadyFired) { try { cb(); } catch (e) {} }
    else { _wasmReadyCallbacks.push(cb); }
  }

  // Expose so external loader (inline <script> in index.html) can call it
  window._onWasmReady  = _onWasmReady;
  window.whenWasmReady = whenWasmReady;

  /* ═══════════════════════════════════════════════════════════════════════════
   * WASM TIMEOUT & RETRY LOGIC (30s with optional single retry)
   * ═══════════════════════════════════════════════════════════════════════════ */
  var _wasmRetried = false;
  
  function _showWasmError(msg) {
    console.error('[HTP Init] WASM ERROR:', msg);
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(10,14,26,0.95);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:"Inter",sans-serif;color:#e2e8f0';
    var box = document.createElement('div');
    box.style.cssText = 'max-width:600px;padding:40px;background:#111827;border:1px solid rgba(79,152,163,0.15);border-radius:8px;text-align:left';
    
    var title = document.createElement('h2');
    title.style.cssText = 'font-size:20px;font-weight:600;margin:0 0 16px 0;color:#ef4444';
    title.textContent = 'Kaspa WASM SDK Failed to Load';
    
    var body = document.createElement('p');
    body.style.cssText = 'margin:0 0 24px 0;line-height:1.6;color:#94a3b8;font-size:14px';
    body.textContent = msg;
    
    var tip = document.createElement('p');
    tip.style.cssText = 'margin:0 0 24px 0;padding:12px;background:#1a2235;border-left:3px solid #4f98a3;font-size:13px;line-height:1.5;color:#cbd5e1';
    tip.textContent = 'Try: 1) Hard refresh (Ctrl+Shift+R), 2) Check browser console, 3) Verify network connection';
    
    var btn = document.createElement('button');
    btn.style.cssText = 'padding:10px 20px;background:#4f98a3;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:14px';
    btn.textContent = 'Refresh Page';
    btn.onclick = function() { window.location.reload(true); };
    
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(tip);
    box.appendChild(btn);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  function _retryWasmLoad() {
    if (_wasmRetried) {
      _showWasmError(
        'Kaspa WASM SDK failed to initialize after retry. ' +
        'Verify you can reach the network and /kaspa_bg.wasm is accessible. ' +
        'If this persists, restart your browser and clear cache.'
      );
      window.dispatchEvent(new CustomEvent('htp:wasm:fatal'));
      return;
    }
    
    _wasmRetried = true;
    console.warn('[HTP Init] WASM retry attempt — reloading module');
    // Attempt to reload kaspaSDK initialization
    if (window.location.href.includes('localhost') || window.location.href.includes('127.0.0.1')) {
      console.log('[HTP Init] Development mode detected — waiting another 20s');
      setTimeout(_retryWasmLoad, 20000);
    } else {
      _showWasmError(
        'Kaspa WASM SDK failed to load. The blockchain integration is unavailable. ' +
        'Please try again in a moment or check your internet connection.'
      );
      window.dispatchEvent(new CustomEvent('htp:wasm:fatal'));
    }
  }

  // Primary timeout: 30 seconds
  var _wasmTimeoutHandle = setTimeout(function () {
    if (_wasmReadyFired) return; // Already loaded
    console.warn('[HTP Init] Primary WASM timeout at 30s — attempting recovery');
    _retryWasmLoad();
  }, 30000);

  // Also listen for the inline SDK's htpWasmReady event (belt-and-suspenders)
  window.addEventListener('htpWasmReady', function () {
    if (!_wasmReadyFired) _onWasmReady();
  });

  /* ═══════════════════════════════════════════════════════════════════════════
   * 3.  IDENTITY & SEAT
   * ═══════════════════════════════════════════════════════════════════════════ */

  function getViewerId() {
    try {
      if (window.connectedAddress) return window.connectedAddress;
      if (window.htpAddress)       return window.htpAddress;
      return localStorage.getItem('htpPlayerId');
    } catch (e) { return null; }
  }

  function initIdentity() {
    var vid = getViewerId();
    if (!vid) {
      var newId = 'P-' + Math.random().toString(36).substr(2, 8).toUpperCase();
      try { localStorage.setItem('htpPlayerId', newId); } catch (e) {}
      console.log('[HTP Init] New anonymous identity:', newId);
    } else {
      console.log('[HTP Init] Identity:', vid.substring(0, 16) + (vid.length > 16 ? '…' : ''));
    }
  }

  function getMySeat(match) {
    var viewerId = getViewerId();
    if (!viewerId) return { seat: 'spectator', viewerId: null };
    var cId   = match.creatorId   || match.creator || match.p1 || (match.info && match.info.creatorId);
    var jId   = match.joinerId    || match.opponent || match.p2 || (match.info && match.info.joinerId);
    var cAddr = match.creatorAddrFull  || match.creatorAddr;
    var jAddr = match.opponentAddrFull || match.opponentAddr;
    var isP1  = (viewerId === cId  || (cAddr && viewerId === cAddr));
    var isP2  = (viewerId === jId  || (jAddr && viewerId === jAddr));
    if (isP1) return { seat: 'player1', viewerId: viewerId };
    if (isP2) return { seat: 'player2', viewerId: viewerId };
    if (match.seats) {
      if (viewerId === match.seats.player1Id || viewerId === match.seats.creatorId) return { seat: 'player1', viewerId: viewerId };
      if (viewerId === match.seats.player2Id || viewerId === match.seats.joinerId)  return { seat: 'player2', viewerId: viewerId };
    }
    return { seat: 'spectator', viewerId: viewerId };
  }

  function getOrientation(match, gameTypeOverride) {
    var ref  = getMySeat(match);
    var seat = ref.seat;
    var g    = (gameTypeOverride || match.gameType || match.game || '').toLowerCase();
    if (seat === 'spectator') return { playerColor: 'w', playerSide: 1, isFlipped: false, seat: 'spectator' };
    return {
      playerColor: seat === 'player2' ? 'b' : 'w',
      playerSide:  seat === 'player2' ? (g === 'checkers' || g === 'ck' ? 3 : 2) : 1,
      isFlipped:   seat === 'player2',
      seat:        seat,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 4.  WALLET
   * ═══════════════════════════════════════════════════════════════════════════ */

  function onWalletConnected(address) {
    if (!address) return;
    window.connectedAddress = address;
    window.htpAddress       = address;
    window.walletAddress    = address;
    try { localStorage.setItem('htpPlayerId', address); } catch (e) {}

    // Notify RPC client to start UTXO tracking
    window.dispatchEvent(new CustomEvent('htp:wallet:connected', { detail: { address: address } }));

    // Update connect button
    var btn = document.getElementById('htp-connect-wallet-btn')
           || document.getElementById('connectWalletBtn');
    if (btn) {
      btn.textContent = address.substring(0, 10) + '…' + address.slice(-4);
      btn.classList.add('connected');
      btn.disabled = false;
    }
    var statusEl = document.getElementById('htp-wallet-status');
    if (statusEl) statusEl.textContent = address.substring(0, 12) + '…';

    console.log('[HTP Init] Wallet connected:', address, '| Net:', window.HTP_NETWORK);
  }

  async function detectAndConnectWallet() {
    // 1. KasWare browser extension
    if (window.kasware) {
      try {
        var accounts = await window.kasware.requestAccounts();
        if (accounts && accounts[0]) { onWalletConnected(accounts[0]); return; }
      } catch (e) {}
    }
    // 2. KaspaWallet extension
    if (window.kaspaWallet) {
      try {
        var addr = await window.kaspaWallet.connect();
        if (addr) { onWalletConnected(addr); return; }
      } catch (e) {}
    }
    // 3. Persisted address from previous session
    try {
      var saved = localStorage.getItem('htpPlayerId');
      if (saved && (saved.startsWith('kaspa') || saved.startsWith('kaspatest'))) {
        onWalletConnected(saved);
      }
    } catch (e) {}
  }

  function bindConnectButton() {
    var btn = document.getElementById('htp-connect-wallet-btn')
           || document.getElementById('connectWalletBtn')
           || document.querySelector('[data-action="connect-wallet"]');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      btn.textContent = 'Connecting…';
      btn.disabled    = true;
      await detectAndConnectWallet();
      if (!window.connectedAddress) {
        btn.textContent = 'Connect Wallet';
        btn.disabled    = false;
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 5.  BOARD CSS
   * ═══════════════════════════════════════════════════════════════════════════ */

  function injectBoardCss() {
    if (document.getElementById('htp-skill-style')) return;
    var style = document.createElement('style');
    style.id   = 'htp-skill-style';
    style.textContent = [
      '.htp-board-container{width:100%;max-width:100%;aspect-ratio:1/1;background:#1e293b;border-radius:12px;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;box-shadow:0 20px 50px rgba(0,0,0,.5),0 0 20px rgba(73,232,194,.1);border:1px solid rgba(255,255,255,.05)}',
      '.htp-board-grid{display:grid;width:100%;height:100%;padding:4px;box-sizing:border-box}',
      '.htp-board-cell{display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer;user-select:none;transition:transform .1s}',
      '.htp-board-cell:active{transform:scale(.95)}',
      '.chess-sq-light{background:#ebecd0;color:#779556}',
      '.chess-sq-dark{background:#779556;color:#ebecd0}',
      '.htp-board-cell.selected{background:rgba(255,255,0,.45)!important;box-shadow:inset 0 0 10px rgba(0,0,0,.2)}',
      '.htp-board-cell.legal-move::after{content:"";width:22%;height:22%;background:rgba(0,0,0,.15);border-radius:50%}',
      '.htp-board-cell.legal-capture::after{content:"";width:85%;height:85%;border:5px solid rgba(0,0,0,.15);border-radius:50%}',
      '.htp-board-cell.last-from,.htp-board-cell.last-to{background:rgba(255,255,0,.25)!important}',
      '.htp-board-cell.check{background:radial-gradient(circle,#ff4d4d 30%,transparent 80%)!important}',
      '.chess-piece-w{color:#fff;text-shadow:0 4px 8px rgba(0,0,0,.5);font-size:min(44px,8.8vw);filter:drop-shadow(0 2px 2px rgba(0,0,0,.2));transition:all .2s}',
      '.chess-piece-b{color:#111;text-shadow:0 2px 4px rgba(255,255,255,.2);font-size:min(44px,8.8vw);filter:drop-shadow(0 2px 2px rgba(0,0,0,.4));transition:all .2s}',
      '.htp-board-cell:hover .chess-piece-w,.htp-board-cell:hover .chess-piece-b{transform:scale(1.05)}',
      '.coord-label{position:absolute;font-size:min(8px,1.8vw);font-weight:800;text-transform:uppercase;user-select:none;pointer-events:none;opacity:.6}',
      '.coord-rank{left:2px;top:2px}',
      '.coord-file{right:2px;bottom:2px}',
      '.chess-sq-light .coord-label{color:#779556}',
      '.chess-sq-dark .coord-label{color:#ebecd0}',
      '@media(max-width:600px){.htp-board-container{border-radius:8px}.coord-label{font-size:8px}}',
    ].join('');
    document.head.appendChild(style);
  }

  function getIndices(count, flipped) {
    var rows = []; for (var i = 7; i >= 0; i--) rows.push(i); if (flipped) rows.reverse();
    var cols = []; for (var j = 0; j <  8; j++) cols.push(j); if (flipped) cols.reverse();
    return { rows: rows, cols: cols };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 6.  DOM READY
   * ═══════════════════════════════════════════════════════════════════════════ */

  function onReady() {
    initIdentity();
    injectBoardCss();
    bindConnectButton();
    detectAndConnectWallet();

    // Restore active match deadlines from Firebase Realtime DB
    if (window.firebase && window.firebase.apps && window.firebase.apps.length && window.firebase.database) {
      window.firebase.database().ref('matches')
        .orderByChild('status').equalTo('active')
        .once('value')
        .then(function (snap) {
          var matches = [];
          snap.forEach(function (child) {
            var m = child.val();
            m.id = child.key;
            matches.push(m);
          });
          if (matches.length) {
            window.dispatchEvent(new CustomEvent('htp:matches:loaded', { detail: { matches: matches } }));
          }
        })
        .catch(function () {});
    }

    console.log('[HTP Init] v3.0 ready | Network:', window.HTP_NETWORK, '|', window.HTP_RPC_URL);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 7.  PUBLIC API
   * ═══════════════════════════════════════════════════════════════════════════ */

  window.htpSkillUI = {
    getViewerId:       getViewerId,
    initIdentity:      initIdentity,
    getMySeat:         getMySeat,
    getOrientation:    getOrientation,
    injectBoardCss:    injectBoardCss,
    getIndices:        getIndices,
    detectNetwork:     detectNetwork,
    NETWORK_MAP:       NETWORK_MAP,
  };
  window.onWalletConnected        = onWalletConnected;
  window.htpInit                  = {
    onWalletConnected:      onWalletConnected,
    detectAndConnectWallet: detectAndConnectWallet,
    detectNetwork:          detectNetwork,
    whenWasmReady:          whenWasmReady,
  };

})(window);
