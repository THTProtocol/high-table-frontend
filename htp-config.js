window.HTP_CONFIG = Object.freeze({
  API_BASE: window.__HTP_API__ || '',
  WS_BASE:  window.__HTP_WS__  || '',
  FIREBASE_PROJECT: 'hightable420',
  VERSION: 'v7.0.0'
});
console.log('[HTP] Config loaded:', window.HTP_CONFIG.VERSION);
