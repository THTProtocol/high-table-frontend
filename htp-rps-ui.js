// htp-rps-ui.js — RPS UI with commit-reveal flow
(function(W) {
'use strict';
W.HTP_RPS = {
  round: 0, score0: 0, score1: 0,
  commits: [null,null,null,null,null,null],
  init: function(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '\x3cdiv class=\"htp-rps-board\"\x3e\x3ch3\x3eRock Paper Scissors\x3c/h3\x3e\x3cdiv id=\"rps-controls\"\x3e\x3cbutton data-move=\"0\"\x3eRock\x3c/button\x3e\x3cbutton data-move=\"1\"\x3ePaper\x3c/button\x3e\x3cbutton data-move=\"2\"\x3eScissors\x3c/button\x3e\x3c/div\x3e\x3c/div\x3e';
  },
  commitMove: async function(player, move) {
    const salt = W.HTP_COMMIT_REVEAL.generateSalt();
    const moveHex = move.toString(16);
    const hash = await W.HTP_COMMIT_REVEAL.hashCommit(moveHex, salt);
    const idx = this.round * 2 + player;
    this.commits[idx] = { hash, move, salt, player };
    return hash;
  }
};
})(window);
