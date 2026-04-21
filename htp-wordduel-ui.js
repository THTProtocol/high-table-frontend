// htp-wordduel-ui.js
(function(W) {
'use strict';
W.HTP_WORDDUEL = {
  init: function(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '\x3cdiv class=\"htp-wordduel-board\"\x3e\x3ch3\x3eWord Duel\x3c/h3\x3e\x3cinput type=\"text\" id=\"wd-guess\" maxlength=\"5\" placeholder=\"5 letters\"\x3e\x3c/div\x3e';
  }
};
})(window);
