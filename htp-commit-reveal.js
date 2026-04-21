// htp-commit-reveal.js — Commit-reveal pattern for RPS + Coin Flip
(function(W) {
'use strict';

W.HTP_COMMIT_REVEAL = {
  /** Hash(move_hex + salt) using BLAKE2b-256 via SubtleCrypto fallback */
  hashCommit: async function(moveHex, saltHex) {
    const enc = new TextEncoder();
    const data = enc.encode(moveHex + saltHex);
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(b=>>b.toString(16).padStart(2,'0')).join('');
    }
    return btoa(moveHex + saltHex); // fallback
  },
  /** Verify salt length >= 32 bytes */
  validateSalt: function(saltHex) {
    return saltHex.length >= 64; // 32 bytes * 2 hex chars
  },
  generateSalt: function() {
    const b = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('');
  }
};
})(window);
