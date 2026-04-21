/**
 * htp-c4-animation.js — HTP Connect 4 v2
 *
 * Renders a 7x6 Connect 4 grid into #c4-board.
 * Features: gravity drop animation, column hover preview, win detection,
 * winning-four highlight, and Firebase sync.
 *
 * Exports:
 *   window.initConnect4(container, config)
 *   window.dropDisc(col, player)
 *   window.checkC4Win()
 *   window.resetC4Board()
 *   window.applyC4Move(col, side)
 */
;(function () {
  'use strict';

  const LOG = (...a) => console.log('[HTP C4 v2]', ...a);

  const ROWS = 6;
  const COLS = 7;

  // Colors
  const EMPTY_COLOR   = 'var(--surface-3)';
  const P1_COLOR      = '#4f98a3';  // teal (local)
  const P2_COLOR      = '#e84040';  // red (opponent)

  // ─────────────────────────────────────────────────────────────────────────
  // INJECT CSS
  // ─────────────────────────────────────────────────────────────────────────

  if (!document.getElementById('htp-c4-styles')) {
    const style = document.createElement('style');
    style.id = 'htp-c4-styles';
    style.textContent = `
      @keyframes c4-drop {
        0%   { transform: translateY(-400%); opacity: 0.3; }
        60%  { transform: translateY(8%); }
        80%  { transform: translateY(-4%); }
        100% { transform: translateY(0); opacity: 1; }
      }
      .c4-piece-drop {
        animation: c4-drop 280ms ease-in forwards;
      }
      @keyframes c4-win-ring {
        0%, 100% { box-shadow: inset 0 0 0 3px rgba(255,255,255,0.8); }
        50%      { box-shadow: inset 0 0 0 5px rgba(255,255,255,1); }
      }
      .c4-cell.win {
        animation: c4-win-ring 0.8s ease-in-out infinite;
      }
      .c4-preview {
        opacity: 0.3;
        transition: opacity 0.15s;
      }
    `;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────

  // Board: 2D array [row][col], 0=empty, 1=player1(teal), 2=player2(red)
  let board = [];
  let mySide = 1;       // 1 or 2
  let currentTurn = 1;   // whose turn it is
  let gameOver = false;
  let matchId = null;
  let containerEl = null;

  function createEmptyBoard() {
    const b = [];
    for (let r = 0; r < ROWS; r++) {
      b.push(new Array(COLS).fill(0));
    }
    return b;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  function render(lastMove) {
    if (!containerEl) return;

    let html = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const val = board[r][c];
        let colorClass = '';
        if (val === 1) colorClass = 'p1';
        else if (val === 2) colorClass = 'p2';

        const isLastDrop = lastMove && lastMove.row === r && lastMove.col === c;
        const dropClass = isLastDrop ? 'c4-piece-drop' : '';

        html += `<div class="c4-cell ${colorClass} ${dropClass}"
          data-c4-row="${r}" data-c4-col="${c}"
          onclick="window._c4ColumnClick && window._c4ColumnClick(${c})"
          onmouseenter="window._c4ColHover && window._c4ColHover(${c})"
          onmouseleave="window._c4ColLeave && window._c4ColLeave(${c})"></div>`;
      }
    }

    containerEl.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COLUMN HOVER PREVIEW
  // ─────────────────────────────────────────────────────────────────────────

  window._c4ColHover = function (col) {
    if (gameOver || currentTurn !== mySide) return;

    // Find the topmost empty row in this column
    const row = getLowestEmptyRow(col);
    if (row === -1) return;

    const cell = containerEl.querySelector(`[data-c4-row="0"][data-c4-col="${col}"]`);
    if (!cell) return;

    // Show preview disc at top
    let preview = containerEl.querySelector('.c4-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'c4-preview';
      preview.style.cssText = `position:absolute;top:0;width:100%;aspect-ratio:1;border-radius:50%;pointer-events:none;z-index:5;background:${mySide === 1 ? P1_COLOR : P2_COLOR}`;
    }
    cell.style.position = 'relative';
    cell.appendChild(preview);
  };

  window._c4ColLeave = function () {
    if (!containerEl) return;
    const preview = containerEl.querySelector('.c4-preview');
    if (preview) preview.remove();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // DROP DISC
  // ─────────────────────────────────────────────────────────────────────────

  function getLowestEmptyRow(col) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r][col] === 0) return r;
    }
    return -1;
  }

  function dropDisc(col, player) {
    if (gameOver) return false;

    const row = getLowestEmptyRow(col);
    if (row === -1) return false;

    board[row][col] = player;
    render({ row, col });

    // Check win
    const win = checkWin(row, col, player);
    if (win) {
      gameOver = true;
      highlightWin(win);
      const winner = player === mySide ? 'w' : 'b'; // map to color for engine
      if (window.htpBoardEngine) {
        window.htpBoardEngine.triggerGameEnd('connect4-win', winner);
      }
      return true;
    }

    // Check draw (board full)
    const isFull = board[0].every((_, c) => getLowestEmptyRow(c) === -1);
    if (isFull) {
      gameOver = true;
      if (window.htpBoardEngine) {
        window.htpBoardEngine.triggerGameEnd('draw', null);
      }
    }

    // Switch turn
    currentTurn = currentTurn === 1 ? 2 : 1;
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CLICK HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  window._c4ColumnClick = function (col) {
    if (gameOver || currentTurn !== mySide) return;

    const success = dropDisc(col, mySide);
    if (!success) return;

    // Relay move to Firebase
    const engine = window.htpBoardEngine;
    const clockState = engine ? engine.getClockState() : null;

    if (typeof window.relaySend === 'function') {
      window.relaySend({
        type:       'move',
        game:       'c4',
        col:        col,
        side:       mySide,
        clockSync:  clockState ? { w: clockState.timeLeft[0], b: clockState.timeLeft[1], ts: Date.now() } : null,
        serverTime: window.firebase ? firebase.database.ServerValue.TIMESTAMP : null,
        clientTime: Date.now()
      });
    }

    // Switch clock
    if (engine) engine.switchClock();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // WIN DETECTION
  // ─────────────────────────────────────────────────────────────────────────

  function checkWin(row, col, player) {
    const directions = [
      [0, 1],   // horizontal
      [1, 0],   // vertical
      [1, 1],   // diagonal down-right
      [1, -1]   // diagonal down-left
    ];

    for (const [dr, dc] of directions) {
      const cells = [[row, col]];

      // Check forward
      for (let i = 1; i < 4; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== player) break;
        cells.push([r, c]);
      }

      // Check backward
      for (let i = 1; i < 4; i++) {
        const r = row - dr * i;
        const c = col - dc * i;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== player) break;
        cells.push([r, c]);
      }

      if (cells.length >= 4) return cells;
    }

    return null;
  }

  function highlightWin(cells) {
    if (!containerEl) return;
    cells.forEach(([r, c]) => {
      const cell = containerEl.querySelector(`[data-c4-row="${r}"][data-c4-col="${c}"]`);
      if (cell) cell.classList.add('win');
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORTED FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────

  /** Initialize Connect 4 board */
  window.initConnect4 = function (container, config) {
    config = config || {};
    containerEl = container || document.getElementById('c4-board');
    board = createEmptyBoard();
    mySide = config.side || 1;
    currentTurn = 1; // player 1 always starts
    gameOver = false;
    matchId = config.matchId || null;

    render();
    LOG('Connect4 initialized, side:', mySide);
  };

  /** Drop a disc into a column (for external use) */
  window.dropDisc = dropDisc;

  /** Check if there's a win at the given position */
  window.checkC4Win = function () {
    // Check entire board for any four-in-a-row
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] !== 0) {
          const result = checkWin(r, c, board[r][c]);
          if (result) return { winner: board[r][c], cells: result };
        }
      }
    }
    return null;
  };

  /** Reset the board */
  window.resetC4Board = function () {
    board = createEmptyBoard();
    currentTurn = 1;
    gameOver = false;
    render();
  };

  /** Apply opponent's move (called from relay) */
  window.applyC4Move = function (col, side) {
    dropDisc(col, side);
  };

  // Backwards compat with old render patch
  window.renderConnect4Board = function (boardState, lastMove) {
    if (boardState) board = boardState;
    render(lastMove);
  };

  LOG('Loaded - Connect 4 with drop animation and win detection');
})();
