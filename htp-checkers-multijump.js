/**
 * htp-checkers-multijump.js — HTP Checkers v2
 *
 * Renders 8x8 checkers board into #checkers-board with full multi-jump chains,
 * mandatory capture enforcement, king promotion, and Firebase sync.
 *
 * Board state: 2D array [row][col]
 *   null = empty, 'r' = red piece, 'b' = black piece
 *   'R' = red king, 'B' = black king
 *   Teal pieces = local player, Red pieces = opponent
 *
 * Exports:
 *   window.initCheckers(container, config)
 *   window.makeCheckersMove(from, to)
 *   window.getValidMoves(row, col)
 *   window.isCheckersGameOver()
 *   window.applyCkMove(from, to, side)
 *   window.HTP_CHECKERS_MULTIJUMP
 */
;(function () {
  'use strict';

  const LOG = (...a) => console.log('[HTP Checkers v2]', ...a);

  const SIZE = 8;
  const DARK_SQ  = '#1a2235';
  const LIGHT_SQ = '#0f1623';
  const TEAL     = 'var(--primary)';
  const RED      = 'var(--red)';

  // Crown SVG (small inline)
  const CROWN_SVG = `<svg class="crown" viewBox="0 0 24 24" fill="var(--gold)" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:50%;height:50%;pointer-events:none"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z"/></svg>`;

  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────

  let board = [];
  let mySide = 'r';         // 'r' (teal) or 'b' (red)
  let currentTurn = 'r';    // red always moves first in checkers
  let selectedPiece = null; // { row, col }
  let validMoves = [];      // [{ row, col }] for selected piece
  let mustJumpFrom = null;  // forced continuation piece { row, col }
  let jumpChain = [];       // accumulate multi-jump moves for relay
  let gameOver = false;
  let matchId = null;
  let containerEl = null;

  function createInitialBoard() {
    const b = [];
    for (let r = 0; r < SIZE; r++) {
      b.push(new Array(SIZE).fill(null));
    }
    // Red pieces on rows 0-2 (dark squares only)
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < SIZE; c++) {
        if ((r + c) % 2 === 1) b[r][c] = 'r';
      }
    }
    // Black pieces on rows 5-7
    for (let r = 5; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if ((r + c) % 2 === 1) b[r][c] = 'b';
      }
    }
    return b;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MOVE VALIDATION
  // ─────────────────────────────────────────────────────────────────────────

  function isMyPiece(piece) {
    if (!piece) return false;
    return piece.toLowerCase() === mySide;
  }

  function isOpponentPiece(piece) {
    if (!piece) return false;
    return piece.toLowerCase() !== mySide;
  }

  function isKing(piece) {
    return piece === piece.toUpperCase() && piece !== piece.toLowerCase();
  }

  /** Get valid jumps (captures) from a position */
  function getJumps(row, col) {
    const piece = board[row][col];
    if (!piece) return [];

    const king = isKing(piece);
    const color = piece.toLowerCase();
    // Regular pieces: red moves down (row+1), black moves up (row-1)
    const dirs = king
      ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
      : (color === 'r' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]]);

    const jumps = [];
    for (const [dr, dc] of dirs) {
      const midR = row + dr, midC = col + dc;
      const landR = row + dr * 2, landC = col + dc * 2;
      if (landR < 0 || landR >= SIZE || landC < 0 || landC >= SIZE) continue;
      const mid = board[midR] && board[midR][midC];
      const land = board[landR] && board[landR][landC];
      if (mid && mid.toLowerCase() !== color && !land) {
        jumps.push({ row: landR, col: landC, over: { row: midR, col: midC } });
      }
    }
    return jumps;
  }

  /** Get valid simple moves (non-captures) from a position */
  function getSimpleMoves(row, col) {
    const piece = board[row][col];
    if (!piece) return [];

    const king = isKing(piece);
    const color = piece.toLowerCase();
    const dirs = king
      ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
      : (color === 'r' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]]);

    const moves = [];
    for (const [dr, dc] of dirs) {
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      if (!board[nr][nc]) {
        moves.push({ row: nr, col: nc });
      }
    }
    return moves;
  }

  /** Get all valid moves for a piece, respecting mandatory capture rules */
  function getValidMovesForPiece(row, col) {
    const piece = board[row][col];
    if (!piece || !isMyPiece(piece)) return [];

    // If in a multi-jump chain, only the forced piece can move
    if (mustJumpFrom) {
      if (row !== mustJumpFrom.row || col !== mustJumpFrom.col) return [];
      return getJumps(row, col);
    }

    // Check if ANY of my pieces have mandatory captures
    const anyCaptures = getAllMandatoryCaptures();
    if (anyCaptures.length > 0) {
      // Only allow jumps from pieces that have captures
      const hasCapture = anyCaptures.some(p => p.row === row && p.col === col);
      if (!hasCapture) return [];
      return getJumps(row, col);
    }

    // No mandatory captures - allow simple moves and jumps
    return [...getJumps(row, col), ...getSimpleMoves(row, col)];
  }

  /** Find all pieces of my side that have mandatory captures */
  function getAllMandatoryCaptures() {
    const pieces = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const p = board[r][c];
        if (p && isMyPiece(p)) {
          const jumps = getJumps(r, c);
          if (jumps.length > 0) {
            pieces.push({ row: r, col: c });
          }
        }
      }
    }
    return pieces;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MOVE EXECUTION
  // ─────────────────────────────────────────────────────────────────────────

  function executeMove(fromRow, fromCol, toRow, toCol) {
    const piece = board[fromRow][fromCol];
    if (!piece) return null;

    const rowDiff = Math.abs(toRow - fromRow);
    const isJump = rowDiff === 2;

    if (isJump) {
      // Capture move
      const midR = (fromRow + toRow) / 2;
      const midC = (fromCol + toCol) / 2;
      board[midR][midC] = null;
    }

    board[toRow][toCol] = piece;
    board[fromRow][fromCol] = null;

    // King promotion
    const color = piece.toLowerCase();
    if (color === 'r' && toRow === SIZE - 1) {
      board[toRow][toCol] = 'R';
    } else if (color === 'b' && toRow === 0) {
      board[toRow][toCol] = 'B';
    }

    // Multi-jump chain check
    if (isJump) {
      jumpChain.push({ from: [fromRow, fromCol], to: [toRow, toCol] });
      const furtherJumps = getJumps(toRow, toCol);
      if (furtherJumps.length > 0) {
        // Must continue jumping
        mustJumpFrom = { row: toRow, col: toCol };
        selectedPiece = mustJumpFrom;
        validMoves = furtherJumps;
        render();
        return { mustContinue: true };
      }
    } else {
      jumpChain.push({ from: [fromRow, fromCol], to: [toRow, toCol] });
    }

    // Turn complete - relay the entire chain
    const chain = [...jumpChain];
    jumpChain = [];
    mustJumpFrom = null;
    selectedPiece = null;
    validMoves = [];

    // Switch turn
    currentTurn = currentTurn === 'r' ? 'b' : 'r';

    render();

    return { mustContinue: false, chain };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  function render() {
    if (!containerEl) return;

    const mandatoryPieces = getAllMandatoryCaptures();
    let html = '';

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const isDark = (r + c) % 2 === 1; // pieces on dark squares only
        const sqClass = isDark ? 'dark' : 'light';
        const bgColor = isDark ? DARK_SQ : LIGHT_SQ;

        const piece = board[r][c];
        let pieceHtml = '';

        if (piece && isDark) {
          const color = piece.toLowerCase();
          const pieceColor = isMyPiece(piece) ? 'teal' : 'red';
          const king = isKing(piece);

          // Check mandatory capture highlight
          const isMandatory = mandatoryPieces.some(p => p.row === r && p.col === c);
          const mandatoryClass = isMandatory ? 'mandatory' : '';

          // Check if this is the multi-jump forced piece
          const isForced = mustJumpFrom && mustJumpFrom.row === r && mustJumpFrom.col === c;
          const forcedStyle = isForced ? 'box-shadow:0 0 12px var(--gold);border-color:var(--gold)' : '';

          pieceHtml = `<div class="checker-piece ${pieceColor} ${mandatoryClass}" style="cursor:pointer;${forcedStyle}">
            ${king ? CROWN_SVG : ''}
          </div>`;
        }

        // Valid move indicator
        const isValidTarget = validMoves.some(m => m.row === r && m.col === c);
        let moveIndicator = '';
        if (isValidTarget) {
          moveIndicator = `<div style="position:absolute;width:30%;height:30%;border-radius:50%;background:rgba(79,152,163,0.5);pointer-events:none;z-index:3;top:50%;left:50%;transform:translate(-50%,-50%)"></div>`;
        }

        // Selected highlight
        const isSelected = selectedPiece && selectedPiece.row === r && selectedPiece.col === c;
        const selStyle = isSelected ? 'box-shadow:inset 0 0 0 2px var(--primary)' : '';

        html += `<div class="checkers-square ${sqClass}" data-ck-row="${r}" data-ck-col="${c}" style="background:${bgColor};position:relative;${selStyle}" onclick="window._ckSquareClick && window._ckSquareClick(${r}, ${c})">
          ${pieceHtml}${moveIndicator}
        </div>`;
      }
    }

    containerEl.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CLICK HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  window._ckSquareClick = function (row, col) {
    if (gameOver || currentTurn !== mySide) return;

    const piece = board[row][col];

    // If we have a forced continuation, only accept valid jump targets
    if (mustJumpFrom) {
      const isTarget = validMoves.some(m => m.row === row && m.col === col);
      if (isTarget) {
        const result = executeMove(mustJumpFrom.row, mustJumpFrom.col, row, col);
        if (result && !result.mustContinue && result.chain) {
          relayCheckersMove(result.chain);
        }
        checkCheckersGameOver();
      }
      return;
    }

    // Clicking on a valid move target
    if (selectedPiece && validMoves.some(m => m.row === row && m.col === col)) {
      const result = executeMove(selectedPiece.row, selectedPiece.col, row, col);
      if (result && !result.mustContinue && result.chain) {
        relayCheckersMove(result.chain);
      }
      checkCheckersGameOver();
      return;
    }

    // Clicking on own piece - select it
    if (piece && isMyPiece(piece)) {
      const moves = getValidMovesForPiece(row, col);
      if (moves.length > 0) {
        selectedPiece = { row, col };
        validMoves = moves;
        render();
      }
      return;
    }

    // Clicking empty square - deselect
    selectedPiece = null;
    validMoves = [];
    render();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RELAY & GAME END
  // ─────────────────────────────────────────────────────────────────────────

  function relayCheckersMove(chain) {
    const engine = window.htpBoardEngine;
    const clockState = engine ? engine.getClockState() : null;

    if (typeof window.relaySend === 'function') {
      window.relaySend({
        type:       'move',
        game:       'checkers',
        chain:      chain,
        from:       chain[0].from,
        to:         chain[chain.length - 1].to,
        side:       mySide,
        clockSync:  clockState ? { w: clockState.timeLeft[0], b: clockState.timeLeft[1], ts: Date.now() } : null,
        serverTime: window.firebase ? firebase.database.ServerValue.TIMESTAMP : null,
        clientTime: Date.now()
      });
    }

    // Switch clock
    if (engine) engine.switchClock();
  }

  function checkCheckersGameOver() {
    // Check if opponent has any moves
    const oppSide = currentTurn;
    let hasMove = false;

    for (let r = 0; r < SIZE && !hasMove; r++) {
      for (let c = 0; c < SIZE && !hasMove; c++) {
        const p = board[r][c];
        if (p && p.toLowerCase() === oppSide) {
          const king = isKing(p);
          const dirs = king
            ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
            : (oppSide === 'r' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]]);

          for (const [dr, dc] of dirs) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && !board[nr][nc]) {
              hasMove = true;
              break;
            }
            // Check jumps
            const lr = r + dr * 2, lc = c + dc * 2;
            if (lr >= 0 && lr < SIZE && lc >= 0 && lc < SIZE) {
              const mid = board[nr] && board[nr][nc];
              if (mid && mid.toLowerCase() !== oppSide && !board[lr][lc]) {
                hasMove = true;
                break;
              }
            }
          }
        }
      }
    }

    // Check if opponent has any pieces
    let hasPieces = false;
    for (let r = 0; r < SIZE && !hasPieces; r++) {
      for (let c = 0; c < SIZE && !hasPieces; c++) {
        if (board[r][c] && board[r][c].toLowerCase() === oppSide) hasPieces = true;
      }
    }

    if (!hasPieces || !hasMove) {
      gameOver = true;
      const winner = mySide === 'r' ? 'w' : 'b';
      if (window.htpBoardEngine) {
        window.htpBoardEngine.triggerGameEnd('checkers-win', winner);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORTED FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────

  /** Initialize checkers board */
  window.initCheckers = function (container, config) {
    config = config || {};
    containerEl = container || document.getElementById('checkers-board');
    board = createInitialBoard();
    mySide = (config.side === 'teal' || config.side === 'r' || config.side === 1) ? 'r' : 'b';
    currentTurn = 'r'; // red always starts
    selectedPiece = null;
    validMoves = [];
    mustJumpFrom = null;
    jumpChain = [];
    gameOver = false;
    matchId = config.matchId || null;

    render();
    LOG('Checkers initialized, side:', mySide);
  };

  /** Make a checkers move (for external use) */
  window.makeCheckersMove = function (from, to) {
    if (gameOver) return null;
    const result = executeMove(from[0], from[1], to[0], to[1]);
    return result;
  };

  /** Get valid moves for a piece at (row, col) */
  window.getValidMoves = function (row, col) {
    if (typeof row === 'object') {
      col = row[1] || row.col;
      row = row[0] || row.row;
    }
    return getValidMovesForPiece(row, col);
  };

  /** Check if the game is over */
  window.isCheckersGameOver = function () {
    return gameOver;
  };

  /** Apply opponent's move (called from relay) */
  window.applyCkMove = function (from, to, side) {
    // Temporarily switch perspective for move execution
    const origSide = mySide;
    const origTurn = currentTurn;

    if (Array.isArray(from) && Array.isArray(to)) {
      board[to[0]][to[1]] = board[from[0]][from[1]];
      board[from[0]][from[1]] = null;

      // Check if it was a jump
      const rowDiff = Math.abs(to[0] - from[0]);
      if (rowDiff === 2) {
        const midR = (from[0] + to[0]) / 2;
        const midC = (from[1] + to[1]) / 2;
        board[midR][midC] = null;
      }

      // King promotion
      const piece = board[to[0]][to[1]];
      if (piece) {
        const color = piece.toLowerCase();
        if (color === 'r' && to[0] === SIZE - 1) board[to[0]][to[1]] = 'R';
        else if (color === 'b' && to[0] === 0) board[to[0]][to[1]] = 'B';
      }

      currentTurn = side === 'r' ? 'b' : 'r';
    }

    render();
    checkCheckersGameOver();
  };

  // Backwards compat
  window.HTP_CHECKERS_MULTIJUMP = {
    getJumps: function (boardState, row, col, king, color) {
      const origBoard = board;
      if (boardState) board = boardState;
      const result = getJumps(row, col);
      board = origBoard;
      return result;
    },
    executeJump: function (boardState, jump) {
      const newBoard = boardState.map(r => [...r]);
      const piece = newBoard[jump.from[0]][jump.from[1]];
      newBoard[jump.from[0]][jump.from[1]] = null;
      newBoard[jump.over[0]][jump.over[1]] = null;
      const king = (jump.to[0] === 0 && piece === 'r') || (jump.to[0] === SIZE - 1 && piece === 'b');
      newBoard[jump.to[0]][jump.to[1]] = king ? piece.toUpperCase() : piece;
      return newBoard;
    },
    handleMove: function (boardState, from, to, color) {
      const piece = boardState[from[0]][from[1]];
      if (!piece) return null;
      const king = isKing(piece);
      const rowDiff = Math.abs(to[0] - from[0]);
      if (rowDiff === 2) {
        const jump = { from, over: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], to };
        const newBoard = this.executeJump(boardState, jump);
        const furtherJumps = this.getJumps(newBoard, to[0], to[1], king, color.toLowerCase());
        if (furtherJumps.length > 0) {
          return { board: newBoard, mustContinue: true, from: to };
        }
        return { board: newBoard, mustContinue: false };
      }
      const newBoard = boardState.map(r => [...r]);
      newBoard[to[0]][to[1]] = newBoard[from[0]][from[1]];
      newBoard[from[0]][from[1]] = null;
      return { board: newBoard, mustContinue: false };
    }
  };

  LOG('Loaded - Checkers with multi-jump chains and mandatory captures');
})();
