// htp-coinflip-ui.js
(function(W) {
'use strict';
W.HTP_COINFLIP = {
  init: function(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '\x3cdiv class=\"htp-coinflip-board\"\x3e\x3ch3\x3eCoin Flip\x3c/h3\x3e\x3cdiv id=\"cf-controls\"\x3e\x3cbutton data-side=\"0\"\x3eHeads\x3c/button\x3e\x3cbutton data-side=\"1\"\x3eTails\x3c/button\x3e\x3c/div\x3e\x3c/div\x3e';
  }
};
})(window);
