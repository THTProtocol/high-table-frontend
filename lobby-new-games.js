/**
 * HTP Lobby New Games
 * Adds new game cards to the lobby and handles player count polling
 */

(function() {
  'use strict';
  
  let lobbyGames = [];
  let playerCountInterval = null;
  let isWasmLoaded = false;

  // New game definitions - these will be added to the existing lobby
  const newGames = [
    {
      id: 'backgammonv1',
      name: 'Backgammon',
      description: 'Classic strategy board game',
      emoji: '🎯',
      category: 'Tactical',
      minStake: 0.001,
      maxStake: 10,
      playersMax: 2,
      status: 'Available',
      contract_type: 'covenant_v2',
      engine_required: false,
      covenant_id: 'backgammon.covenant.axo'
    },
    {
      id: 'pokerv1',
      name: 'Poker',
      description: 'Texas Hold\'em 2-player showdown',
      emoji: '♠️',
      category: 'Skill',
      minStake: 0.001,
      maxStake: 10,
      playersMax: 2,
      status: 'Available',
      contract_type: 'covenant_v2',
      engine_required: false,
      covenant_id: 'poker.covenant.axo'
    },
    {
      id: 'blackjackv1',
      name: 'Blackjack',
      description: 'Player vs dealer, 21 wins',
      emoji: '🃏',
      category: 'Luck',
      minStake: 0.001,
      maxStake: 5,
      playersMax: 2,
      status: 'Available',
      contract_type: 'covenant_v2',
      engine_required: false,
      covenant_id: 'blackjack.covenant.axo'
    },
    {
      id: 'rockpaperscissors',
      name: 'Rock Paper Scissors',
      description: 'Quick decision game',
      emoji: '✊',
      category: 'Instant',
      minStake: 0.0001,
      maxStake: 1,
      playersMax: 2,
      status: 'Available',
      contract_type: 'oracle',
      oracle_type: 'random',
      engine_required: false,
      covenant_id: 'rps.covenant.axo'
    },
    {
      id: 'coinflip',
      name: 'Coin Flip',
      description: 'Simple 50/50 game',
      emoji: '🪙',
      category: 'Luck',
      minStake: 0.0001,
      maxStake: 2,
      playersMax: 2,
      status: 'Available',
      contract_type: 'oracle',
      oracle_type: 'coinflip',
      engine_required: false,
      covenant_id: 'coinflip.covenant.axo'
    },
    {
      id: 'wordduel',
      name: 'Word Duel',
      description: 'Vocabulary battle',
      emoji: '🔤',
      category: 'Skill',
      minStake: 0.001,
      maxStake: 5,
      playersMax: 2,
      status: 'Available',
      contract_type: 'oracle',
      oracle_type: 'wordgame',
      engine_required: false,
      covenant_id: 'wordduel.covenant.axo'
    }
  ];

  /**
   * Initialize lobby games and monitoring
   */
  function initLobbyGames() {
    console.log('[HTP Lobby New Games] Initializing new games');
    
    // Add new games to the global lobby games array if it exists
    if (window.lobbyGames && Array.isArray(window.lobbyGames)) {
      window.lobbyGames = window.lobbyGames.concat(newGames);
      lobbyGames = window.lobbyGames;
      console.log('[HTP Lobby New Games] Added', newGames.length, 'new games to lobby');
    } else {
      // Fallback: create our own lobby if nothing exists yet
      lobbyGames = newGames;
      console.log('[HTP Lobby New Games] Created standalone lobby with', newGames.length, 'games');
    }
    
    // Render new game cards
    renderNewGames();
    
    // Start player count monitoring
    startPlayerCountMonitoring();
    
    // Listen for WASM loading state
    window.addEventListener('htp:wasm:loaded', () => {
      isWasmLoaded = true;
      updateGameAvailability();
    });
  }

  /**
   * Render new game cards to the DOM
   */
  function renderNewGames() {
    const lobbyContainer = document.querySelector('.lobby-container, .games-lobby, .game-list, #lobby-games');
    if (!lobbyContainer) {
      console.log('[HTP Lobby New Games] No lobby container found, waiting...');
      setTimeout(renderNewGames, 1000);
      return;
    }
    
    const existingNewGames = lobbyContainer.querySelectorAll('.htp-new-game-card');
    if (existingNewGames.length > 0) {
      console.log('[HTP Lobby New Games] New games already rendered');
      return;
    }
    
    newGames.forEach(game => {
      const gameCard = createGameCard(game);
      lobbyContainer.appendChild(gameCard);
    });
    
    console.log('[HTP Lobby New Games] Rendered', newGames.length, 'new game cards');
  }

  /**
   * Create individual game card element
   */
  function createGameCard(game) {
    const card = document.createElement('div');
    card.className = 'htp-new-game-card';
    card.innerHTML = `
      <div class="htp-game-card-content">
        <div class="htp-game-header">
          <div class="htp-game-emoji" title="${game.name}">${game.emoji}</div>
          <h3 class="htp-game-name">${game.name}</h3>
          <span class="htp-game-category ${game.category.toLowerCase()}">${game.category}</span>
        </div>
        <p class="htp-game-description">${game.description}</p>
        <div class="htp-game-info">
          <div class="htp-info-row">
            <span>Stake Range:</span>
            <span class="htp-stake-range">${game.minStake} - ${game.maxStake} KAS</span>
          </div>
          <div class="htp-info-row">
            <span>Players:</span>
            <span class="htp-player-count" data-game-id="${game.id}">• Calcing...</span>
          </div>
          <div class="htp-info-row">
            <span>Covenant:</span>
            <span class="htp-covenant-id" title="${game.covenant_id || 'N/A'}">${game.covenant_id ? game.covenant_id.split('.')[0] : 'N/A'}</span>
          </div>
        </div>
      </div>`;
    return card;
  }

  /**
   * Start player count monitoring
   */
  function startPlayerCountMonitoring() {
    if (!window.socketHandler) {
      console.log('[HTP Lobby New Games] No socket handler, waiting...');
      setTimeout(startPlayerCountMonitoring, 1000);
      return;
    }
    
    playerCountInterval = setInterval(() => {
      updatePlayerCounts();
    }, 5000);
    console.log('[HTP Lobby New Games] Started player count monitoring');
  }

  /**
   * Update player counts for all games
   */
  function updatePlayerCounts() {
    if (!window.socketHandler || !window.socketHandler.getRooms) return;
    
    // Use the existing rooms API if available
    const rooms = window.socketHandler.getRooms();
    if (!rooms || !Array.isArray(rooms)) return;

    newGames.forEach(game => {
      const countEl = document.querySelector(`[data-game-id="${game.id}"]`);
      if (!countEl) return;
      
      const room = rooms.find(r => r.room && (r.room.includes(game.name.toLowerCase()) || r.room.includes(game.gameType || '')));
      const count = room ? (room.players || 0) : 0;
      countEl.textContent = `${count} player${count !== 1 ? 's' : ''}`;
    });
  }

  /**
   * Update game availability based on WASM status
   */
  function updateGameAvailability() {
    if (!isWasmLoaded) return;
    
    const cards = document.querySelectorAll('.htp-new-game-card');
    cards.forEach((card, index) => {
      const game = newGames[index];
      if (game && game.engine_required !== false) {
        // Mark as available when WASM is loaded for games that need engines
        card.classList.add('available');
      }
    });
  }

  /**
   * Handle game click/selection
   */
  function onGameSelect(game) {
    console.log('[HTP Lobby New Games] Game selected:', game.name);
    
    if (!game) return;
    
    // Check if WASM is loaded
    if (!isWasmLoaded && game.engine_required !== false) {
      console.warn('[HTP Lobby New Games] WASM not loaded, cannot start', game.name);
      showToast('Loading wallet engine...', 'warn');
      return;
    }
    
    // Show toast with game selected
    showToast(`Selected ${game.name}`, 'info');
    
    // Use existing game creation flow if available
    if (window.createMatch) {
      // Set the game type in the UI
      const gameSelect = document.querySelector('[data-game-selector]');
      if (gameSelect) {
        gameSelect.value = game.gameType || game.id;
      }
      
      // Trigger match creation with appropriate defaults
      const matchData = {
        game: game.gameType || game.id,
        stake: Math.max(game.minStake || 0.001, 0.01)
      };
      
      window.createMatch(matchData);
    } else {
      // Fallback: show a join/create dialog
      showGameDialog(game);
    }
  }

  /**
   * Show game join/create dialog (fallback)
   */
  function showGameDialog(game) {
    if (!game) return;
    
    showToast(`${game.name} - coming soon to HTP`, 'success');
  }

  /**
   * Show toast notification (fallback if not available)
   */
  function showToast(message, type) {
    if (window.toast) {
      window.toast(message, type);
    } else {
      console.log(`[HTP Lobby New Games] ${type.toUpperCase()}: ${message}`);
    }
  }

  /**
   * Init when DOM is ready
   */
  function waitForDOM() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initLobbyGames);
    } else {
      initLobbyGames();
    }
  }

  /**
   * Export functions to global scope
   */
  // Expose functions for external use
  if (window.HTPLobby) {
    window.HTPLobby.newGames = { 
      initLobbyGames,
      renderNewGames,
      newGames 
    };
  } else {
    window.HTPLobby = {
      newGames: { 
        initLobbyGames,
        renderNewGames,
        newGames
      }
    };
  }

  /**
   * Auto-initialize when script loads
   */
  setTimeout(waitForDOM, 100);
  
  // Listen for when the lobby system is ready
  window.addEventListener('htp:lobby:ready', () => {
    console.log('[HTP Lobby New Games] Lobby system ready, initializing...');
    initLobbyGames();
  });

})();