/**
 * HTP Chess Touch Drag-and-Drop
 * Touch support for chess game on mobile devices
 */

(function() {
  'use strict';
  
  let touchDragState = {
    active: false,
    source: null,
    draggedPiece: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    ghostElement: null,
    originalSquare: null,
    originalPiece: null
  };

  /**
   * Initialize touch support for chess board
   */
  window.initChessTouch = function(boardSelector = '.chess-board, #chess-board, chessboard') {
    const board = document.querySelector(boardSelector);
    if (!board) {
      console.log('[HTP Chess Touch] Board not found, not initializing');
      return;
    }
    
    // Check if already initialized
    if (board.dataset.touchInitialized === 'true') {
      return;
    }
    
    console.log('[HTP Chess Touch] Initializing touch support');
    board.dataset.touchInitialized = 'true';
    
    // Add touch styles
    addTouchStyles();
    
    // Bind touch events
    board.addEventListener('touchstart', handleTouchStart, { passive: false });
    board.addEventListener('touchmove', handleTouchMove, { passive: false });
    board.addEventListener('touchend', handleTouchEnd);
    board.addEventListener('touchcancel', handleTouchCancel);
    
    // Also bind to document for drag continuation
    document.addEventListener('touchmove', handleDocumentTouchMove, { passive: false });
    document.addEventListener('touchend', handleDocumentTouchEnd);
  };

  function addTouchStyles() {
    if (document.getElementById('htp-chess-touch-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'htp-chess-touch-styles';
    style.textContent = `
      .piece-ghost {
        position: fixed !important;
        pointer-events: none !important;
        z-index: 10000 !important;
        transform: translate(-50%, -50%) scale(1.2);
        opacity: 0.9;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        transition: transform 0.1s ease;
      }
      
      .square-drag-target {
        background-color: rgba(73, 232, 194, 0.3) !important;
        box-shadow: inset 0 0 10px rgba(73, 232, 194, 0.5);
      }
      
      .square-drag-hover {
        background-color: rgba(124, 111, 247, 0.4) !important;
        box-shadow: inset 0 0 15px rgba(124, 111, 247, 0.6);
      }
      
      .piece-original {
        opacity: 0.3;
      }
      
      @media (pointer: coarse) {
        .piece {
          touch-action: none !important;
          user-select: none !important;
          -webkit-user-select: none !important;
        }
        
        .square {
          touch-action: manipulation !important;
        }
      }

      /* Enhanced mobile touch experience */
      .square {
        position: relative;
        cursor: grab;
      }
      
      .piece {
        cursor: grab;
        transition: opacity 0.2s ease;
      }
      
      .square:active {
        cursor: grabbing;
      }
      
      .piece:active {
        cursor: grabbing;
      }
      
      .touch-hint {
        position: absolute;
        bottom: 2px;
        right: 2px;
        width: 4px;
        height: 4px;
        background: rgba(73, 232, 194, 0.6);
        border-radius: 50%;
        pointer-events: none;
        animation: touchHint 2s ease-in-out infinite;
      }
      
      @keyframes touchHint {
        0%, 100% { transform: scale(1); opacity: 0.6; }
        50% { transform: scale(1.5); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  function handleTouchStart(e) {
    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    
    // Check if touching a piece
    const piece = target?.closest('.piece, [data-piece], .chess-piece');
    if (!piece) return;
    
    e.preventDefault();
    
    // Get the square
    const square = target?.closest('.square, [data-square]');
    if (!square) return;
    
    touchDragState.active = true;
    touchDragState.source = square.dataset.square || square.id || getSquareFromElement(square);
    touchDragState.startX = touch.clientX;
    touchDragState.startY = touch.clientY;
    touchDragState.currentX = touch.clientX;
    touchDragState.currentY = touch.clientY;
    touchDragState.originalSquare = square;
    touchDragState.originalPiece = piece;
    
    // Create ghost element
    createGhostPiece(piece, touch);
    
    // Dim original piece
    piece.classList.add('piece-original');
    
    // Add visual feedback
    square.classList.add('square-drag-target');
    
    // Trigger custom event
    window.dispatchEvent(new CustomEvent('htp:chess:touchStart', {
      detail: { source: touchDragState.source, piece: piece.dataset.piece }
    }));
  }

  function handleTouchMove(e) {
    if (!touchDragState.active) return;
    
    e.preventDefault();
    
    const touch = e.touches[0];
    touchDragState.currentX = touch.clientX;
    touchDragState.currentY = touch.clientY;
    
    // Move ghost piece
    if (touchDragState.ghostElement) {
      touchDragState.ghostElement.style.left = touch.clientX + 'px';
      touchDragState.ghostElement.style.top = touch.clientY + 'px';
    }
    
    // Highlight hovered square
    highlightHoveredSquare(touch.clientX, touch.clientY);
  }

  function handleTouchEnd(e) {
    if (!touchDragState.active) return;
    
    cleanupDragState();
  }

  function handleTouchCancel(e) {
    if (!touchDragState.active) return;
    
    cleanupDragState(true);
  }

  function handleDocumentTouchMove(e) {
    if (!touchDragState.active) return;
    e.preventDefault();
  }

  function handleDocumentTouchEnd(e) {
    if (!touchDragState.active) return;
    
    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const square = target?.closest('.square, [data-square]');
    
    if (square) {
      const targetSquare = square.dataset.square || square.id || getSquareFromElement(square);
      
      // Dispatch move event
      if (touchDragState.source && targetSquare && touchDragState.source !== targetSquare) {
        window.dispatchEvent(new CustomEvent('htp:chess:move', {
          detail: {
            from: touchDragState.source,
            to: targetSquare,
            piece: touchDragState.originalPiece?.dataset?.piece
          }
        }));
        
        // Also try to call standard move function if available
        if (window.onChessMove && typeof window.onChessMove === 'function') {
          window.onChessMove(touchDragState.source, targetSquare);
        }
      }
    }
    
    cleanupDragState();
  }

  function createGhostPiece(originalPiece, touch) {
    const rect = originalPiece.getBoundingClientRect();
    const ghost = originalPiece.cloneNode(true);
    
    ghost.classList.add('piece-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.left = touch.clientX + 'px';
    ghost.style.top = touch.clientY + 'px';
    ghost.style.position = 'fixed';
    
    document.body.appendChild(ghost);
    touchDragState.ghostElement = ghost;
  }

  function highlightHoveredSquare(x, y) {
    // Remove previous highlight
    document.querySelectorAll('.square-drag-target, .square-drag-hover').forEach(el => {
      el.classList.remove('square-drag-target', 'square-drag-hover');
    });
    
    const target = document.elementFromPoint(x, y);
    const square = target?.closest('.square, [data-square]');
    
    if (square && square !== touchDragState.originalSquare) {
      square.classList.add('square-drag-hover');
    }
  }

  function cleanupDragState(cancelled = false) {
    // Remove ghost
    if (touchDragState.ghostElement) {
      touchDragState.ghostElement.remove();
    }
    
    // Remove highlight from original piece
    if (touchDragState.originalPiece) {
      touchDragState.originalPiece.classList.remove('piece-original');
    }
    
    // Remove all hover highlights
    document.querySelectorAll('.square-drag-target, .square-drag-hover').forEach(el => {
      el.classList.remove('square-drag-target', 'square-drag-hover');
    });
    
    // Reset state
    touchDragState = {
      active: false,
      source: null,
      draggedPiece: null,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      ghostElement: null,
      originalSquare: null,
      originalPiece: null
    };
  }

  function getSquareFromElement(el) {
    // Try to extract square notation from various formats
    const classes = el.className || '';
    const match = classes.match(/(?:square-|)([a-h][1-8])/);
    return match ? match[1] : el.id || '';
  }

  /**
   * Check if device is touch-enabled
   */
  window.isTouchDevice = function() {
    return (('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            (navigator.msMaxTouchPoints > 0));
  };

  /**
   * Auto-initialize on DOM ready if touch device
   */
  document.addEventListener('DOMContentLoaded', function() {
    if (window.isTouchDevice()) {
      console.log('[HTP Chess Touch] Touch device detected, preparing touch support');
      
      // Watch for chess board being added
      const observer = new MutationObserver(function(mutations) {
        const board = document.querySelector('.chess-board, #chess-board, chessboard');
        if (board && !board.dataset.touchInitialized) {
          window.initChessTouch();
        }
      });
      
      observer.observe(document.body, { childList: true, subtree: true });
    }
  });

  // Export for manual initialization
  window.HTPChessTouch = {
    init: window.initChessTouch,
    isTouchDevice: window.isTouchDevice
  };

})();