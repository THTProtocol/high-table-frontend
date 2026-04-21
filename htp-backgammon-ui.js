// htp-backgammon-ui.js — Thin JS wrapper for Rust backgammon WASM
(function(W) {
'use strict';
W.HTP_BACKGAMMON = {
  init: function(containerId, options) {
    console.log('[HTP Backgammon] init', containerId, options);
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '\x3cdiv class=\"htp-game-loading\"\x3eBackgammon loading...\x3c/div\x3e';
    // WASM game engine loaded via pkg/htp_rust_backend_bg.js
    W.dispatchEvent(new CustomEvent('htp:game:ready', {detail:{game:'backgammon',el:el}}));
  }
};
})(window);
