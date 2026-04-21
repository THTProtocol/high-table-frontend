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
            <span class="htp-covenant-id" title="${game.covenant_id || 'N/A'}"