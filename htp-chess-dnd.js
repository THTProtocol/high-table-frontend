/**
 * htp-chess-dnd.js — HTP Chess Drag & Drop v2
 *
 * Clean drag and drop for chess pieces. Handles both mouse and touch events.
 * Works with the #chess-board container rendered by htp-chess-ui.js.
 *
 * Behavior:
 *   - mousedown/touchstart on own piece: lift piece (scale 1.1, z-index 1000),
 *     show legal move highlights (teal circle for moves, teal ring for captures)
 *   - mousemove/touchmove: piece follows cursor/finger
 *   - mouseup/touchend on legal square: execute move, relay to Firebase
 *   - mouseup/touchend on illegal square: snap back with shake animation
 */
;(function () {
  'use strict';

  const LOG = (...a) => console.log('[HTP Chess DnD v2]', ...a);

  // State
  let dragPiece    = null;   // the img element being dragged
  let dragSource   = null;   // source square name (e.g. "e2")
  let dragClone    = null;   // floating clone element
  let legalSquares = [];     // list of legal target square names
  let offsetX = 0, offsetY = 0;

  // ─────────────────────────────────────────────────────────────────────────
  // INJECT SHAKE ANIMATION CSS
  // ─────────────────────────────────────────────────────────────────────────

  if (!document.getElementById('htp-dnd-styles')) {
    const style = document.createElement('style');
    style.id = 'htp-dnd-styles';
    style.textContent = `
      @keyframes htp-shake {
        0%, 100% { transform: translateX(0); }
        25%      { transform: translateX(-3px); }
        75%      { transform: translateX(3px); }
      }
      .htp-shake { animation: htp-shake 100ms ease-in-out 3; }
      .htp-drag-clone {
        position: fixed;
        pointer-events: none;
        z-index: 1000;
        transform: scale(1.1);
        transition: none;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4));
      }
    `;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  function getBoard() {
    return document.getElementById('chess-board');
  }

  function getSquareFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const sq = el.closest('[data-sq]');
    return sq ? sq.dataset.sq : null;
  }

  function showLegalMoveHighlights(squares) {
    const board = getBoard();
    if (!board) return;

    squares.forEach(sq => {
      const cell = board.querySelector(`[data-sq="${sq}"]`);
      if (!cell) return;

      const game = window.chessGame;
      const hasPiece = game && game.get(sq);

      const indicator = document.createElement('div');
      indicator.className = 'htp-dnd-highlight';

      if (hasPiece) {
        // Teal ring around capture square
        indicator.style.cssText = 'position:absolute;inset:0;border-radius:50%;border:3px solid rgba(79,152,163,0.5);pointer-events:none;z-index:5';
      } else {
        // Small teal circle for empty square
        indicator.style.cssText = 'position:absolute;width:12px;height:12px;border-radius:50%;background:rgba(79,152,163,0.6);pointer-events:none;z-index:5;top:50%;left:50%;transform:translate(-50%,-50%)';
      }
      cell.appendChild(indicator);
    });
  }

  function clearHighlights() {
    const board = getBoard();
    if (!board) return;
    board.querySelectorAll('.htp-dnd-highlight').forEach(el => el.remove());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DRAG START
  // ─────────────────────────────────────────────────────────────────────────

  function onDragStart(e) {
    const game = window.chessGame;
    const ui = window.chessUI;
    if (!game || !ui) return;
    if (game.turn() !== ui.playerColor) return;

    // Find the piece img
    const touch = e.touches ? e.touches[0] : e;
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target) return;

    const pieceImg = target.closest('.piece') || (target.closest('[data-sq]') && target.closest('[data-sq]').querySelector('.piece'));
    if (!pieceImg) return;

    const sqEl = pieceImg.closest('[data-sq]');
    if (!sqEl) return;

    const sq = sqEl.dataset.sq;
    const piece = game.get(sq);
    if (!piece || piece.color !== ui.playerColor) return;

    // Prevent default to stop text selection and native drag
    e.preventDefault();

    dragSource = sq;
    dragPiece = pieceImg;

    // Get legal moves for this piece
    const moves = game.moves({ square: sq, verbose: true });
    legalSquares = moves.map(m => m.to);

    // Show highlights
    showLegalMoveHighlights(legalSquares);

    // Create floating clone
    const rect = pieceImg.getBoundingClientRect();
    dragClone = pieceImg.cloneNode(true);
    dragClone.className = 'htp-drag-clone';
    dragClone.style.width = rect.width + 'px';
    dragClone.style.height = rect.height + 'px';
    document.body.appendChild(dragClone);

    offsetX = touch.clientX - rect.left - rect.width / 2;
    offsetY = touch.clientY - rect.top - rect.height / 2;

    dragClone.style.left = (touch.clientX - rect.width / 2) + 'px';
    dragClone.style.top = (touch.clientY - rect.height / 2) + 'px';

    // Hide original piece
    pieceImg.style.opacity = '0.3';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DRAG MOVE
  // ─────────────────────────────────────────────────────────────────────────

  function onDragMove(e) {
    if (!dragClone) return;
    e.preventDefault();

    const touch = e.touches ? e.touches[0] : e;
    const rect = dragClone.getBoundingClientRect();
    dragClone.style.left = (touch.clientX - rect.width / 2) + 'px';
    dragClone.style.top = (touch.clientY - rect.height / 2) + 'px';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DRAG END
  // ─────────────────────────────────────────────────────────────────────────

  function onDragEnd(e) {
    if (!dragClone || !dragSource) {
      cleanup();
      return;
    }

    const touch = e.changedTouches ? e.changedTouches[0] : e;
    const targetSq = getSquareFromPoint(touch.clientX, touch.clientY);

    clearHighlights();

    if (targetSq && legalSquares.includes(targetSq) && targetSq !== dragSource) {
      // Legal move - execute it
      if (typeof window.htpChessClick === 'function') {
        // First select the source, then click target
        const ui = window.chessUI;
        if (ui) {
          ui.selectedSq = dragSource;
          ui.legalMoves = legalSquares;
        }
        window.htpChessClick(targetSq);
      }
      cleanup();
    } else {
      // Illegal move - snap back with shake
      snapBack();
    }
  }

  function snapBack() {
    if (dragPiece) {
      dragPiece.style.opacity = '1';
      dragPiece.classList.add('htp-shake');
      setTimeout(() => dragPiece.classList.remove('htp-shake'), 300);
    }
    cleanup();
  }

  function cleanup() {
    if (dragClone) {
      dragClone.remove();
      dragClone = null;
    }
    if (dragPiece) {
      dragPiece.style.opacity = '1';
      dragPiece = null;
    }
    dragSource = null;
    legalSquares = [];
    clearHighlights();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INSTALL EVENT LISTENERS
  // ─────────────────────────────────────────────────────────────────────────

  function installDnD() {
    const board = getBoard();
    if (!board) {
      setTimeout(installDnD, 1000);
      return;
    }

    // Mouse events
    board.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    // Touch events
    board.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);

    LOG('Drag and drop installed on #chess-board');
  }

  // Wait for board to be available
  window.addEventListener('htpWasmReady', installDnD);
  window.addEventListener('htpWasmFailed', installDnD);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(installDnD, 500));
  } else {
    setTimeout(installDnD, 500);
  }

  // Re-install on board re-render (MutationObserver)
  const boardObserver = new MutationObserver(() => {
    const board = getBoard();
    if (board && !board._htpDndInstalled) {
      board._htpDndInstalled = true;
      // Events are on document level, just need to mark board
    }
  });

  if (document.body) {
    boardObserver.observe(document.body, { childList: true, subtree: true });
  }

  LOG('Loaded - mouse + touch drag and drop');
})();
