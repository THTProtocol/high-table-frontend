#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# apply-rebuild.sh — High Table Protocol v7 Rebuild
# Makes high-table-frontend work like /27
# Usage:
#   chmod +x scripts/apply-rebuild.sh
#   ./scripts/apply-rebuild.sh            # apply only
#   ./scripts/apply-rebuild.sh --deploy   # apply + deploy
# =============================================================

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INDEX="$ROOT/index.html"
DEPLOY=false
[[ "${1:-}" == "--deploy" ]] && DEPLOY=true

echo "==> HTP v7 Rebuild Script"
echo "    Root: $ROOT"
echo "    Deploy: $DEPLOY"

# 0. Safety
if [[ ! -f "$INDEX" ]]; then
  echo "ERROR: index.html not found at $INDEX"
  exit 1
fi
cp "$INDEX" "$INDEX.bak-$(date +%s)"
echo "==> Backup created"

# 1. Verify firebase config
if grep -q '"hightable420"' "$ROOT/.firebaserc" 2>/dev/null; then
  echo "==> .firebaserc OK (hightable420)"
else
  cat > "$ROOT/.firebaserc" << 'FBRC'
{
  "projects": {
    "default": "hightable420"
  }
}
FBRC
  echo "==> .firebaserc updated"
fi

# 2. Create htp-config.js
cat > "$ROOT/htp-config.js" << 'HTPCONFIG'
window.HTP_CONFIG = Object.freeze({
  API_BASE: window.__HTP_API__ || '',
  WS_BASE:  window.__HTP_WS__  || '',
  FIREBASE_PROJECT: 'hightable420',
  VERSION: 'v7.0.0'
});
console.log('[HTP] Config loaded:', window.HTP_CONFIG.VERSION);
HTPCONFIG
echo "==> htp-config.js created"

# 3. Create htp-game-router.js
cat > "$ROOT/htp-game-router.js" << 'GAMEROUTER'
(function() {
  'use strict';
  const GAMES = [
    { id:'poker',      name:'Poker',              emoji:'🃏', desc:'Texas Holdem with KAS stakes. Covenant-secured pots.',       script:'htp-poker-ui.js' },
    { id:'blackjack',  name:'Blackjack',           emoji:'🂡', desc:'Beat the dealer. Provably fair commit-reveal.',              script:'htp-blackjack-ui.js' },
    { id:'chess',      name:'Chess',               emoji:'♛', desc:'Rated chess with KAS wagers. Drag-and-drop.',               script:'htp-chess-ui.js' },
    { id:'checkers',   name:'Checkers',            emoji:'⬛', desc:'Classic checkers with multi-jump.',                          script:'htp-checkers-multijump.js' },
    { id:'backgammon', name:'Backgammon',           emoji:'🎲', desc:'Strategy board game with KAS stakes.',                       script:'htp-backgammon-ui.js' },
    { id:'connect4',   name:'Connect 4',           emoji:'🔴', desc:'Drop discs, connect four. Animated.',                        script:'htp-c4-animation.js' },
    { id:'coinflip',   name:'Coin Flip',           emoji:'🪙', desc:'Instant 50/50. Commit-reveal fairness.',                     script:'htp-coinflip-ui.js' },
    { id:'rps',        name:'Rock Paper Scissors', emoji:'✊', desc:'Classic RPS with ZK commit-reveal.',                        script:'htp-rps-ui.js' },
    { id:'wordduel',   name:'Word Duel',           emoji:'📝', desc:'Word game battles with KAS wagers.',                         script:'htp-wordduel-ui.js' }
  ];
  window.HTP_GAMES = GAMES;

  function buildLobbyGrid() {
    var c = document.getElementById('games-grid');
    if (!c) return;
    c.innerHTML = GAMES.map(function(g) {
      return '<div class="game-card" data-game="'+g.id+'" onclick="window.htpOpenGame(\''+g.id+'\')" tabindex="0" role="button" aria-label="Play '+g.name+'">' +
        '<div class="game-card__emoji">'+g.emoji+'</div>' +
        '<h3 class="game-card__title">'+g.name+'</h3>' +
        '<p class="game-card__desc">'+g.desc+'</p>' +
        '<button class="btn btn-primary btn-sm">Play Now</button>' +
      '</div>';
    }).join('');
  }

  window.htpOpenGame = function(gameId) {
    var game = GAMES.find(function(g){return g.id===gameId;});
    if (!game) return;
    document.querySelectorAll('section.view').forEach(function(s){s.classList.remove('show');});
    var section = document.getElementById('v-game-'+gameId);
    if (!section) {
      section = document.createElement('section');
      section.className = 'view';
      section.id = 'v-game-'+gameId;
      section.innerHTML = '<div class="game-view"><div class="game-view__header">' +
        '<button class="btn btn-ghost" onclick="window.htpShowGames()">&larr; Back to Games</button>' +
        '<h2>'+game.emoji+' '+game.name+'</h2></div>' +
        '<div class="game-view__root" id="game-root-'+gameId+'">' +
        '<div class="skeleton-loader">Loading '+game.name+'...</div></div></div>';
      var main = document.querySelector('main');
      if (main) main.appendChild(section);
    }
    section.classList.add('show');
    if (!document.querySelector('script[data-game="'+gameId+'"]')) {
      var s = document.createElement('script');
      s.src = game.script;
      s.dataset.game = gameId;
      s.onload = function(){console.log('[HTP] '+game.name+' loaded');};
      s.onerror = function(){
        var root = document.getElementById('game-root-'+gameId);
        if(root) root.innerHTML='<div class="toast toast--warning">'+game.name+' module not available yet. Coming soon!</div>';
      };
      document.body.appendChild(s);
    }
  };

  window.htpShowGames = function() {
    document.querySelectorAll('section.view').forEach(function(s){s.classList.remove('show');});
    var g = document.getElementById('v-games');
    if (g) g.classList.add('show');
  };

  if (document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded', buildLobbyGrid);
  } else {
    buildLobbyGrid();
  }
})();
GAMEROUTER
echo "==> htp-game-router.js created"

# 4. Inject games sections + nav link + script tags into index.html
# Only inject if not already present (idempotent)

if ! grep -q 'v-games' "$INDEX"; then
  echo "==> Injecting games sections into index.html"

  # 4a. Add Games nav link after the last nav item
  sed -i 's|<a href="#" onclick="showView('\''v-terms'\''[^"]*"[^>]*>Terms</a>|&\n            <a href="#" onclick="showView('\''v-games'\'');return false;" class="nav-link" data-view="v-games">🎮 Games</a>|' "$INDEX" 2>/dev/null || true

  # 4b. Inject Games lobby + Poker + Blackjack sections before </main>
  GAMES_HTML='<!-- === GAMES LOBBY (injected by apply-rebuild.sh) === -->
<section class="view" id="v-games">
  <div style="padding:2rem 1rem;max-width:1200px;margin:0 auto">
    <h2 style="color:var(--accent,#00ffa3);font-size:1.8rem;margin-bottom:0.5rem">🎮 Games</h2>
    <p style="color:var(--text-secondary,#a0a0a0);margin-bottom:2rem">Skill games with KAS stakes. Every match settled on-chain via covenants.</p>
    <div id="games-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.25rem"></div>
  </div>
</section>

<section class="view" id="v-game-poker">
  <div style="padding:2rem 1rem;max-width:900px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">
      <button class="btn btn-ghost" onclick="window.htpShowGames()">&larr; Back to Games</button>
      <h2 style="color:var(--accent,#00ffa3);margin:0">🃏 Poker</h2>
    </div>
    <p style="color:var(--text-secondary,#a0a0a0);margin-bottom:1.5rem">Texas Holdem with covenant-secured pots on Kaspa. Create a table or join an open one.</p>
    <div style="display:flex;gap:1rem;margin-bottom:2rem;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="window.htpOpenGame('\''poker'\'')">Create Table</button>
      <button class="btn btn-ghost" onclick="window.htpOpenGame('\''poker'\'')">Join Table</button>
    </div>
    <div id="game-root-poker"><div class="skeleton-loader">Loading Poker tables...</div></div>
  </div>
</section>

<section class="view" id="v-game-blackjack">
  <div style="padding:2rem 1rem;max-width:900px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">
      <button class="btn btn-ghost" onclick="window.htpShowGames()">&larr; Back to Games</button>
      <h2 style="color:var(--accent,#00ffa3);margin:0">🂡 Blackjack</h2>
    </div>
    <p style="color:var(--text-secondary,#a0a0a0);margin-bottom:1.5rem">Beat the dealer with provably fair commit-reveal. Non-custodial, instant settlement.</p>
    <div style="display:flex;gap:1rem;margin-bottom:2rem;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="window.htpOpenGame('\''blackjack'\'')">New Game</button>
    </div>
    <div id="game-root-blackjack"><div class="skeleton-loader">Loading Blackjack...</div></div>
  </div>
</section>
<!-- === END GAMES LOBBY === -->'

  # Insert before </main>
  TEMP=$(mktemp)
  awk -v games="$GAMES_HTML" '/<\/main>/{print games}1' "$INDEX" > "$TEMP" && mv "$TEMP" "$INDEX"

  # 4c. Add game-card CSS before </style> (first occurrence)
  GAME_CSS='.game-card{background:var(--card-bg,#1a1a2e);border:1px solid var(--border,#2a2a3e);border-radius:12px;padding:1.5rem;cursor:pointer;transition:all .2s;text-align:center}
.game-card:hover{border-color:var(--accent,#00ffa3);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,255,163,.1)}
.game-card__emoji{font-size:2.5rem;margin-bottom:.75rem}
.game-card__title{color:var(--text,#fff);font-size:1.1rem;margin:0 0 .5rem}
.game-card__desc{color:var(--text-secondary,#a0a0a0);font-size:.85rem;line-height:1.4;margin:0 0 1rem}
.btn-sm{font-size:.8rem;padding:.4rem 1rem}
.game-view{padding:1rem}
.game-view__header{display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap}
.game-view__header h2{color:var(--accent,#00ffa3);margin:0}
.skeleton-loader{color:var(--text-secondary,#a0a0a0);padding:2rem;text-align:center;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}'

  TEMP2=$(mktemp)
  awk -v css="$GAME_CSS" '/<\/style>/ && !done {print css; done=1} 1' "$INDEX" > "$TEMP2" && mv "$TEMP2" "$INDEX"

  # 4d. Add script tags before </body>
  SCRIPTS='<script src="htp-config.js"></script>
<script src="htp-game-router.js"></script>
<script src="lobby-new-games.js"></script>'

  sed -i "s|</body>|${SCRIPTS}\n</body>|" "$INDEX"

  echo "==> Games sections, CSS, nav link, and scripts injected"
else
  echo "==> Games sections already present, skipping injection"
fi

# 5. Polish: ensure all existing buttons have cursor pointer
if ! grep -q 'cursor:pointer' "$INDEX" 2>/dev/null; then
  sed -i 's|\.btn{|.btn{cursor:pointer;|' "$INDEX" 2>/dev/null || true
fi

# 6. Git commit
echo "==> Staging changes..."
cd "$ROOT"
git add -A
git status --short

echo ""
echo "==> Done! Changes staged. Review with: git diff --cached"
echo "    Commit with: git commit -m 'feat(v7): /27 parity - games lobby, poker, blackjack, all buttons wired'"
echo "    Push with:   git push origin ai/htp-v7-rebuild"

# 7. Deploy if requested
if $DEPLOY; then
  echo "==> Deploying to hightable420..."
  npx firebase-tools deploy --only hosting --project hightable420
  echo "==> Deployed to https://hightable420.web.app/"
fi

echo "==> All done!"
