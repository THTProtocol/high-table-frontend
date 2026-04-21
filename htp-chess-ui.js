/**
 * htp-chess-ui.js — HTP Chess Board Renderer v4
 *
 * Renders a clean 8x8 chess board into #chess-board using the new DOM structure.
 * Uses Lichess SVG pieces from https://lichess1.org/assets/piece/cburnett/.
 * Integrates with chess.js for move validation and game state.
 *
 * Exports:
 *   window.initChessBoard(container, config)
 *   window.updatePosition(fen)
 *   window.flipBoard()
 *   window.getMove()
 *   window.renderChessBoard()
 *   window.htpChessClick(sq)
 *   window.htpShowWaitingRoom(opts)
 *   window.htpShowPromotionModal(color, callback)
 */
;(function () {
  'use strict';

  const LOG = (...a) => console.log('[HTP Chess UI v4]', ...a);

  // ─────────────────────────────────────────────────────────────────────────
  // PIECE SVG URLS — Lichess cburnett set
  // color: "w" or "b", piece: K/Q/R/B/N/P (uppercase)
  // ─────────────────────────────────────────────────────────────────────────

  const PIECE_SVG_BASE = 'https://lichess1.org/assets/piece/cburnett/';

  function pieceSvgUrl(color, type) {
    return `${PIECE_SVG_BASE}${color}${type}.svg`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────

  // Shared with other modules via window.chessUI
  function ensureUI() {
    if (!window.chessUI) {
      window.chessUI = {};
    }
    const ui = window.chessUI;
    if (!ui.playerColor) ui.playerColor = 'w';
    if (ui.isFlipped === undefined) ui.isFlipped = false;
    if (!ui.selectedSq) ui.selectedSq = null;
    if (!ui.legalMoves) ui.legalMoves = [];
    if (!ui.lastMove) ui.lastMove = null;
    return ui;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BOARD RENDERER
  // ─────────────────────────────────────────────────────────────────────────

  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

  function renderChessBoard() {
    const el = document.getElementById('chess-board');
    if (!el) return;

    const game = window.chessGame;
    const ui = ensureUI();
    const flipped = ui.isFlipped || false;
    const selSq = ui.selectedSq;
    const legalMv = ui.legalMoves || [];
    const lastMv = ui.lastMove || null;

    const dFiles = flipped ? [...FILES].reverse() : FILES;
    const dRanks = flipped ? [...RANKS].reverse() : RANKS;

    let html = '';

    for (let ri = 0; ri < dRanks.length; ri++) {
      const rank = dRanks[ri];
      for (let fi = 0; fi < dFiles.length; fi++) {
        const file = dFiles[fi];
        const sq = file + rank;
        const fileIdx = FILES.indexOf(file);
        const isLight = (fileIdx + rank) % 2 === 0;

        // Get piece at square
        const piece = game ? (game.get(sq) || null) : null;

        // Highlight states
        const isLastMv   = lastMv && (sq === lastMv.from || sq === lastMv.to);
        const isSelected = sq === selSq;
        const isLegal    = legalMv.includes(sq);
        const isCapture  = isLegal && !!piece;

        // Square colors: dark #1a2235, light #243050
        let bgColor = isLight ? '#243050' : '#1a2235';
        if (isLastMv)   bgColor = isLight ? '#2a4060' : '#223555';
        if (isSelected) bgColor = isLight ? '#2e5570' : '#264560';

        // CSS class
        const lightClass = isLight ? 'light' : 'dark';

        // Coordinate labels
        let coordHtml = '';
        // File label along bottom row
        if (ri === 7) {
          coordHtml += `<span style="position:absolute;bottom:2px;right:3px;font-size:9px;font-weight:700;color:rgba(79,152,163,0.6);pointer-events:none">${file}</span>`;
        }
        // Rank label along left column
        if (fi === 0) {
          coordHtml += `<span style="position:absolute;top:2px;left:3px;font-size:9px;font-weight:700;color:rgba(79,152,163,0.6);pointer-events:none">${rank}</span>`;
        }

        // Piece image
        let pieceHtml = '';
        if (piece) {
          const url = pieceSvgUrl(piece.color, piece.type.toUpperCase());
          pieceHtml = `<img src="${url}" alt="${piece.color}${piece.type}" class="piece" draggable="true" style="width:80%;height:80%;position:absolute;top:10%;left:10%;pointer-events:auto;z-index:2;user-select:none">`;
        }

        // Legal move indicators
        let legalHtml = '';
        if (isLegal && !isCapture) {
          // Small teal circle for empty legal move square
          legalHtml = `<div class="legal-move" style="position:absolute;width:12px;height:12px;border-radius:50%;background:rgba(79,152,163,0.6);pointer-events:none;z-index:3"></div>`;
        } else if (isCapture) {
          // Teal ring for capture square
          legalHtml = `<div class="legal-capture" style="position:absolute;width:90%;height:90%;border-radius:50%;border:3px solid rgba(79,152,163,0.5);pointer-events:none;z-index:3"></div>`;
        }

        html += `<div class="chess-square ${lightClass}" data-sq="${sq}" style="background:${bgColor};position:relative" onclick="window.htpChessClick && window.htpChessClick('${sq}')">
          ${coordHtml}${pieceHtml}${legalHtml}
        </div>`;
      }
    }

    el.innerHTML = html;

    // Update status
    updateChessStatus();
  }

  function updateChessStatus() {
    const game = window.chessGame;
    const ui = ensureUI();

    // Update any status element if present
    const statusEl = document.getElementById('htpChessStatus');
    if (!statusEl || !game) return;

    if (game.isCheckmate()) {
      statusEl.textContent = 'Checkmate!';
      statusEl.style.color = 'var(--primary)';
    } else if (game.isCheck()) {
      statusEl.textContent = 'Check!';
      statusEl.style.color = 'var(--error)';
    } else if (game.isDraw() || game.isStalemate()) {
      statusEl.textContent = 'Draw';
      statusEl.style.color = 'var(--text-muted)';
    } else {
      const myTurn = game.turn() === (ui.playerColor || 'w');
      statusEl.textContent = myTurn ? 'Your turn' : "Opponent's turn";
      statusEl.style.color = myTurn ? 'var(--primary)' : 'var(--text-muted)';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SQUARE CLICK HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  window.htpChessClick = function (sq) {
    const game = window.chessGame;
    const ui = ensureUI();
    if (!game) return;
    if (game.turn() !== ui.playerColor) return; // not your turn

    if (ui.selectedSq) {
      // Check if this is a pawn promotion move
      const piece = game.get(ui.selectedSq);
      const targetRank = parseInt(sq[1], 10);
      const isPromotion = piece && piece.type === 'p' &&
        ((piece.color === 'w' && targetRank === 8) || (piece.color === 'b' && targetRank === 1));

      if (isPromotion && ui.legalMoves.includes(sq)) {
        // Show promotion modal
        window.htpShowPromotionModal(piece.color, function (promoteTo) {
          executeMove(ui.selectedSq, sq, promoteTo);
        });
        return;
      }

      // Try move
      const move = executeMove(ui.selectedSq, sq, 'q');
      if (move) return;

      // Clicked another own piece - reselect
      ui.selectedSq = null;
      ui.legalMoves = [];
    }

    // Select piece
    const piece = game.get(sq);
    if (piece && piece.color === ui.playerColor) {
      ui.selectedSq = sq;
      ui.legalMoves = game.moves({ square: sq, verbose: true }).map(m => m.to);
    }
    renderChessBoard();
  };

  function executeMove(from, to, promotion) {
    const game = window.chessGame;
    const ui = ensureUI();
    if (!game) return null;

    let move;
    try {
      move = game.move({ from, to, promotion: promotion || 'q' });
    } catch (_) {
      return null;
    }
    if (!move) return null;

    ui.lastMove   = { from, to };
    ui.selectedSq = null;
    ui.legalMoves = [];

    // Relay move with clock sync
    const engine = window.htpBoardEngine;
    const clockSync = engine ? engine.getClockState() : null;

    if (typeof window.relaySend === 'function') {
      window.relaySend({
        type:       'move',
        game:       'chess',
        fen:        game.fen(),
        move:       { from: move.from, to: move.to, san: move.san },
        clockSync:  clockSync ? { w: clockSync.timeLeft[0], b: clockSync.timeLeft[1], ts: Date.now() } : null,
        serverTime: window.firebase ? firebase.database.ServerValue.TIMESTAMP : null,
        clientTime: Date.now()
      });
    }

    // Switch clock
    if (engine) engine.switchClock();

    renderChessBoard();

    // Check game over
    if (engine) engine.checkChessGameEnd();

    return move;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORTED FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────

  /** Initialize the chess board in a container with config */
  window.initChessBoard = function (container, config) {
    config = config || {};
    const ui = ensureUI();

    if (config.side) ui.playerColor = config.side;
    ui.isFlipped = config.side === 'b';
    ui.selectedSq = null;
    ui.legalMoves = [];
    ui.lastMove = null;
    ui.matchId = config.matchId || null;

    // Init chess engine if not already done
    if (window.Chess && !window.chessGame) {
      window.chessGame = new Chess();
    }

    renderChessBoard();
    LOG('Chess board initialized, side:', config.side || 'w');
  };

  /** Update board position from a FEN string */
  window.updatePosition = function (fen) {
    if (!window.chessGame) return;
    window.chessGame.load(fen);
    renderChessBoard();
  };

  /** Flip the board orientation */
  window.flipBoard = function () {
    const ui = ensureUI();
    ui.isFlipped = !ui.isFlipped;
    renderChessBoard();
  };

  /** Get the last move made (for external consumers) */
  window.getMove = function () {
    const ui = ensureUI();
    return ui.lastMove;
  };

  // Main render function alias
  window.renderChessBoard = renderChessBoard;
  window.renderChessBoardFull = renderChessBoard;

  // ─────────────────────────────────────────────────────────────────────────
  // WAITING ROOM
  // ─────────────────────────────────────────────────────────────────────────

  window.htpShowWaitingRoom = function (opts) {
    opts = opts || {};
    const game        = opts.game || 'chess';
    const timeControl = opts.timeControl || '5+0';
    const series      = opts.series || 'Single game';
    const stakeKas    = parseFloat(opts.stakeKas || 5);
    const matchId     = opts.matchId || '';
    const myAddr      = opts.myAddr || '';
    const shortAddr   = myAddr ? myAddr.slice(0, 10) + '...' + myAddr.slice(-6) : 'kaspa:qr...';

    const gameIcons  = { chess: '&#9823;', connect4: '&#128308;', c4: '&#128308;', checkers: '&#11035;' };
    const gameLabels = { chess: 'Chess', connect4: 'Connect 4', c4: 'Connect 4', checkers: 'Checkers' };
    const icon  = gameIcons[game]  || '&#9823;';
    const label = gameLabels[game] || 'Chess';

    // Remove stale waiting room
    const stale = document.getElementById('htp-waiting-room');
    if (stale) stale.remove();

    const overlay = document.createElement('div');
    overlay.id = 'htp-waiting-room';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;z-index:8888;padding:16px;backdrop-filter:blur(4px)';

    overlay.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;width:100%;max-width:440px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.7)">
        <div style="background:var(--surface-2);padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:9px;background:rgba(79,152,163,0.08);border:1.5px solid rgba(79,152,163,0.2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${icon}</div>
          <div>
            <div style="font-size:15px;font-weight:600;color:var(--text)">${label} &middot; ${timeControl}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${series}</div>
          </div>
          <div style="margin-left:auto;background:rgba(79,152,163,0.08);border:1px solid rgba(79,152,163,0.22);color:var(--primary);font-size:11px;font-weight:600;padding:4px 11px;border-radius:20px">ESCROW LOCKED</div>
        </div>
        <div style="padding:22px;display:flex;flex-direction:column;gap:18px">
          <div style="display:grid;grid-template-columns:1fr 36px 1fr;align-items:center;gap:8px">
            <div style="background:var(--surface-2);border:1px solid rgba(79,152,163,0.25);border-radius:10px;padding:14px 10px;text-align:center">
              <div style="width:36px;height:36px;border-radius:50%;background:rgba(79,152,163,0.12);border:1.5px solid rgba(79,152,163,0.35);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-size:16px">&#129489;</div>
              <div style="font-size:12px;font-weight:600;color:var(--text)">You</div>
              <div style="font-size:9px;color:var(--text-muted);font-family:monospace;margin-top:3px">${shortAddr}</div>
            </div>
            <div style="text-align:center;font-size:11px;font-weight:700;color:var(--text-faint)">VS</div>
            <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:14px 10px;text-align:center">
              <div id="htp-wr-opp-avatar" style="width:36px;height:36px;border-radius:50%;background:var(--surface-3);border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-size:18px;color:var(--text-faint)">?</div>
              <div id="htp-wr-opp-name" style="font-size:12px;font-weight:600;color:var(--text-faint)">Waiting...</div>
              <div style="font-size:9px;color:var(--text-faint);margin-top:3px">open challenge</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:11px 13px">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-bottom:4px">Game</div>
              <div style="font-size:13px;font-weight:600;color:var(--text)">${label}</div>
            </div>
            <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:11px 13px">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-bottom:4px">Time</div>
              <div style="font-size:13px;font-weight:600;color:var(--text);font-family:monospace">${timeControl}</div>
            </div>
            <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:11px 13px">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-bottom:4px">Series</div>
              <div style="font-size:13px;font-weight:600;color:var(--text)">${series}</div>
            </div>
            <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:11px 13px">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-bottom:4px">Colors</div>
              <div style="font-size:13px;font-weight:600;color:var(--primary)">Random</div>
            </div>
          </div>
          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:14px 16px">
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:10px;display:flex;align-items:center;gap:6px">
              <span style="width:6px;height:6px;border-radius:50%;background:var(--primary);display:inline-block;flex-shrink:0"></span>
              Escrow locked on-chain &middot; Auto-payout on result
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:20px;font-weight:700;color:var(--primary);font-family:monospace">${stakeKas} KAS</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:1px">Winner takes all</div>
              </div>
              <div style="font-size:11px;color:var(--primary);background:rgba(79,152,163,0.08);padding:5px 12px;border-radius:20px;border:1px solid rgba(79,152,163,0.2)">On-chain</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div id="htp-wr-spinner" style="width:14px;height:14px;border-radius:50%;border:2px solid var(--border);border-top-color:var(--primary);animation:htpSpin .7s linear infinite;flex-shrink:0"></div>
            <span id="htp-wr-status" style="font-size:12px;color:var(--text-muted)">Sharing match link &middot; Anyone can join</span>
          </div>
          <button id="htp-wr-cancel" class="btn btn-secondary" style="width:100%;border-color:var(--error);color:var(--error)">Cancel &amp; Refund Escrow</button>
        </div>
      </div>
      <style>
        @keyframes htpSpin { to { transform:rotate(360deg); } }
        @keyframes htpOppIn { from{opacity:0;transform:scale(.8)} to{opacity:1;transform:scale(1)} }
      </style>`;

    document.body.appendChild(overlay);

    // Cancel button
    overlay.querySelector('#htp-wr-cancel').addEventListener('click', () => {
      if (typeof window.htpCancelMatch === 'function') window.htpCancelMatch(matchId);
      overlay.remove();
    });

    // Status cycle
    const msgs = [
      'Sharing match link - Anyone can join',
      'Waiting for opponent to deposit escrow...',
      'Match ID copied to clipboard',
      'Opponent will be assigned colors randomly...'
    ];
    let phase = 0;
    const statusInterval = setInterval(() => {
      phase = (phase + 1) % msgs.length;
      const el = document.getElementById('htp-wr-status');
      if (el) el.textContent = msgs[phase];
    }, 4000);

    return {
      dismiss: function () {
        clearInterval(statusInterval);
        overlay.remove();
      },
      setOpponent: function (addr) {
        clearInterval(statusInterval);
        const sp = document.getElementById('htp-wr-spinner');
        const st = document.getElementById('htp-wr-status');
        const av = document.getElementById('htp-wr-opp-avatar');
        const nm = document.getElementById('htp-wr-opp-name');
        if (sp) sp.style.borderTopColor = '#4ade80';
        if (st) { st.textContent = 'Opponent joined! Starting game...'; st.style.color = '#4ade80'; }
        if (av) { av.textContent = '\u{1F9D1}'; av.style.color = 'var(--text)'; av.style.animation = 'htpOppIn .4s ease'; av.style.background = 'rgba(79,152,163,0.08)'; av.style.borderColor = 'rgba(79,152,163,0.35)'; }
        if (nm) { nm.textContent = addr ? addr.slice(0, 10) + '...' : 'Opponent'; nm.style.color = 'var(--text)'; }
        setTimeout(() => overlay.remove(), 1800);
      }
    };
  };

  // ─────────────────────────────────────────────────────────────────────────
  // PAWN PROMOTION MODAL
  // ─────────────────────────────────────────────────────────────────────────

  window.htpShowPromotionModal = function (color, callback) {
    const pieces = [
      { name: 'q', label: 'Queen' },
      { name: 'r', label: 'Rook' },
      { name: 'b', label: 'Bishop' },
      { name: 'n', label: 'Knight' }
    ];

    const overlay = document.createElement('div');
    overlay.id = 'htp-promotion-modal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(3px)';

    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface);border:1px solid rgba(79,152,163,0.3);border-radius:14px;padding:28px;display:flex;gap:16px;flex-direction:column;align-items:center;box-shadow:0 20px 60px rgba(0,0,0,0.8)';
    box.innerHTML = '<div style="color:var(--primary);font-size:13px;font-weight:600;letter-spacing:0.06em">PROMOTE PAWN</div>';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px';

    let resolved = false;
    function choose(piece) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      overlay.remove();
      callback(piece);
    }

    pieces.forEach(p => {
      const btn = document.createElement('button');
      const url = pieceSvgUrl(color, p.name.toUpperCase());
      btn.innerHTML = `<img src="${url}" alt="${p.label}" style="width:42px;height:42px">`;
      btn.style.cssText = 'background:var(--surface-2);border:1.5px solid var(--border);border-radius:10px;cursor:pointer;padding:10px 14px;transition:border-color .15s,background .15s';
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'rgba(79,152,163,0.5)'; btn.style.background = 'rgba(79,152,163,0.06)'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--border)'; btn.style.background = 'var(--surface-2)'; });
      btn.addEventListener('click', () => choose(p.name));
      row.appendChild(btn);
    });

    box.appendChild(row);
    const countdown = document.createElement('div');
    countdown.style.cssText = 'color:var(--text-faint);font-size:11px;margin-top:4px';
    countdown.textContent = 'Auto-selects Queen in 10s';
    box.appendChild(countdown);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const timer = setTimeout(() => choose('q'), 10000);
  };

  LOG('Loaded - Lichess SVG pieces, waiting room, promotion modal');
})();
