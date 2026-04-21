window.HTP_WALLET_LOGOS = {
  KasWare: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="10" fill="#1a3a2a"/>
    <path d="M10 20L20 10L30 20L20 30Z" stroke="#49eacb" stroke-width="2" fill="none"/>
    <circle cx="20" cy="20" r="4" fill="#49eacb"/>
  </svg>`,
  Kastle: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="10" fill="#1a1a2e"/>
    <rect x="12" y="18" width="16" height="12" stroke="#49eacb" stroke-width="2" fill="none"/>
    <path d="M10 18L20 10L30 18" stroke="#49eacb" stroke-width="2" fill="none"/>
    <rect x="17" y="22" width="6" height="8" fill="#49eacb" opacity="0.6"/>
  </svg>`,
  Kasanova: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="10" fill="#1e1a30"/>
    <path d="M12 28L20 12L28 28" stroke="#49eacb" stroke-width="2" fill="none"/>
    <path d="M15 22H25" stroke="#49eacb" stroke-width="2"/>
  </svg>`,
  Kaspium: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="10" fill="#0d1f1a"/>
    <circle cx="20" cy="20" r="10" stroke="#49eacb" stroke-width="2" fill="none"/>
    <path d="M15 20L18 17L21 20L25 15" stroke="#49eacb" stroke-width="2" fill="none"/>
  </svg>`,
  KaspaCom: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="10" fill="#0f1f18"/>
    <path d="M10 15H30M10 20H25M10 25H20" stroke="#49eacb" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  DEXcc: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="10" fill="#1a1a1a"/>
    <circle cx="14" cy="20" r="5" stroke="#49eacb" stroke-width="2" fill="none"/>
    <circle cx="26" cy="20" r="5" stroke="#49eacb" stroke-width="2" fill="none"/>
    <path d="M19 20H21" stroke="#49eacb" stroke-width="2"/>
  </svg>`
};

// Replace the favicon fetch function globally
window.getWalletLogo = function(walletName) {
  return window.HTP_WALLET_LOGOS[walletName] || window.HTP_WALLET_LOGOS['KasWare'];
};
