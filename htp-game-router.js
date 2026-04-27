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
