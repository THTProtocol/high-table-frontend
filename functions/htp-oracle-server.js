const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { Chess } = require('chess.js');

admin.initializeApp();
const db = admin.database();

// Oracle key — set via: firebase functions:secrets:set HTP_ORACLE_PRIV_KEY
// (requires Blaze plan). Falls back to env config for Spark plan.
function getOracleKey() {
  return process.env.HTP_ORACLE_PRIV_KEY
    || (functions.config().oracle || {}).priv_key
    || null;
}

function signResult(matchId, winner, reason) {
  const key = getOracleKey();
  if (!key) return null;
  const payload = matchId + ':' + winner + ':' + reason;
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

// ── Chess move validator ──────────────────────────────────────────────────
exports.validateChessMove = functions.https.onCall(async (data, context) => {
  const { matchId, pgn, move, playerId } = data;
  if (!matchId || !move) return { valid: false, error: 'Missing matchId or move' };

  const game = new Chess();
  if (pgn) {
    try { game.loadPgn(pgn); } catch(e) { return { valid: false, error: 'Invalid PGN' }; }
  }

  let result;
  try {
    result = game.move(move);
  } catch (e) {
    return { valid: false, error: 'Illegal move: ' + move, detail: e.message };
  }
  if (!result) return { valid: false, error: 'Illegal move: ' + move };

  const response = {
    valid: true,
    fen: game.fen(),
    pgn: game.pgn(),
    move: result,
    gameOver: game.isGameOver(),
    inCheck: game.inCheck(),
    inCheckmate: game.isCheckmate(),
    inDraw: game.isDraw(),
    inStalemate: game.isStalemate(),
    winner: null,
    reason: null,
    signature: null
  };

  if (game.isGameOver()) {
    if (game.isCheckmate()) {
      // game.turn() returns the LOSER (side to move who is mated)
      response.winner = (game.turn() === 'b') ? 'white' : 'black';
      response.reason = 'checkmate';
    } else if (game.isDraw()) {
      response.winner = 'draw';
      response.reason = game.isStalemate() ? 'stalemate' : 'draw';
    }

    if (response.winner && matchId) {
      response.signature = signResult(matchId, response.winner, response.reason);
      await db.ref('settlement/' + matchId + '/pending').set({
        winner: response.winner,
        reason: response.reason,
        signature: response.signature,
        decidedAt: Date.now(),
        pgn: game.pgn()
      });
    }
  }

  // Write validated move to Firebase
  await db.ref('relay/' + matchId + '/moves').push({
    player: playerId,
    move: result.san,
    fen: game.fen(),
    ts: Date.now(),
    validated: true
  });

  return response;
});

// ── Connect4 move validator ───────────────────────────────────────────────
exports.validateConnect4Move = functions.https.onCall(async (data, context) => {
  const { matchId, board, col, player, playerId } = data;
  if (typeof col === 'undefined' || !board || !player) {
    return { valid: false, error: 'Missing col, board, or player' };
  }

  const ROWS = 6, COLS = 7;

  // Find lowest empty row in column
  let row = -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (!board[r][col]) { row = r; break; }
  }
  if (row === -1) return { valid: false, error: 'Column full' };

  // Place piece
  const newBoard = board.map(r => [...r]);
  newBoard[row][col] = player;

  // Check win — all 4 directions
  function checkWin(b, p) {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (b[r][c] !== p) continue;
        for (const [dr,dc] of dirs) {
          let count = 1;
          for (let i = 1; i < 4; i++) {
            const nr = r + dr*i, nc = c + dc*i;
            if (nr<0||nr>=ROWS||nc<0||nc>=COLS||b[nr][nc]!==p) break;
            count++;
          }
          if (count >= 4) return true;
        }
      }
    }
    return false;
  }

  const won = checkWin(newBoard, player);
  const full = newBoard[0].every(c => c !== null && c !== 0 && c !== '');
  const draw = !won && full;

  const response = {
    valid: true,
    board: newBoard,
    row,
    col,
    player,
    gameOver: won || draw,
    winner: won ? player : (draw ? 'draw' : null),
    reason: won ? 'connect4' : (draw ? 'draw' : null),
    signature: null
  };

  if (response.gameOver && matchId) {
    response.signature = signResult(matchId, String(response.winner), response.reason);
    await db.ref('settlement/' + matchId + '/pending').set({
      winner: response.winner,
      reason: response.reason,
      signature: response.signature,
      decidedAt: Date.now()
    });
  }

  await db.ref('relay/' + matchId + '/moves').push({
    player: playerId,
    col, row,
    ts: Date.now(),
    validated: true
  });

  return response;
});

// ── Checkers move validator ───────────────────────────────────────────────
exports.validateCheckersMove = functions.https.onCall(async (data, context) => {
  const { matchId, board, move: mv, player, playerId } = data;
  // board: 8x8 array, cells: '' | 'r' | 'R' | 'b' | 'B'
  // mv: 'c3-d4' or 'a1-c3-e5' (multi-jump)
  // player: 'r' (Red/Player1) or 'b' (Black/Player2)
  if (!board || !mv || !player) return { valid: false, error: 'Missing board, move, or player' };

  function colIdx(c) { return c.charCodeAt(0) - 'a'.charCodeAt(0); }
  function rowIdx(r) { return parseInt(r, 10) - 1; }

  const steps = mv.split('-');
  if (steps.length < 2) return { valid: false, error: 'Invalid move format' };

  const newBoard = board.map(row => [...row]);
  const isCapture = Math.abs(rowIdx(steps[1][1]) - rowIdx(steps[0][1])) === 2;

  // Validate mandatory capture: if any capture exists, must capture
  function getCaptures(b, pl) {
    const caps = [];
    const own = pl === 'r' ? ['r','R'] : ['b','B'];
    const opp = pl === 'r' ? ['b','B'] : ['r','R'];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (!own.includes(b[r][c])) continue;
        const isKing = b[r][c] === b[r][c].toUpperCase() && b[r][c] !== b[r][c].toLowerCase();
        const dirs = pl === 'r'
          ? (isKing ? [[-1,-1],[-1,1],[1,-1],[1,1]] : [[1,-1],[1,1]])
          : (isKing ? [[-1,-1],[-1,1],[1,-1],[1,1]] : [[-1,-1],[-1,1]]);
        for (const [dr,dc] of dirs) {
          const mr = r+dr, mc = c+dc, lr = r+2*dr, lc = c+2*dc;
          if (lr<0||lr>7||lc<0||lc>7) continue;
          if (opp.includes(b[mr][mc]) && b[lr][lc] === '') caps.push(true);
        }
      }
    }
    return caps;
  }

  const hasCaptures = getCaptures(newBoard, player).length > 0;
  if (hasCaptures && !isCapture) return { valid: false, error: 'Mandatory capture exists' };

  // Apply each step
  for (let i = 0; i < steps.length - 1; i++) {
    const fc = colIdx(steps[i][0]), fr = rowIdx(steps[i][1]);
    const tc = colIdx(steps[i+1][0]), tr = rowIdx(steps[i+1][1]);
    const piece = newBoard[fr][fc];
    if (!piece || piece === '') return { valid: false, error: 'No piece at ' + steps[i] };
    const own = player === 'r' ? ['r','R'] : ['b','B'];
    if (!own.includes(piece)) return { valid: false, error: 'Not your piece' };
    const dr = tr - fr, dc = tc - fc;
    if (Math.abs(dr) !== Math.abs(dc)) return { valid: false, error: 'Not diagonal' };
    const isKing = piece === piece.toUpperCase() && piece !== piece.toLowerCase();
    if (!isKing && Math.abs(dr) !== 1 && Math.abs(dr) !== 2) return { valid: false, error: 'Invalid move distance' };
    if (newBoard[tr][tc] !== '') return { valid: false, error: 'Target occupied' };
    // Capture: remove jumped piece
    if (Math.abs(dr) === 2) {
      const mr = fr + dr/2, mc = fc + dc/2;
      newBoard[mr][mc] = '';
    } else if (Math.abs(dr) > 1 && isKing) {
      // Flying kings not supported in this ruleset (standard checkers)
      return { valid: false, error: 'Flying king not supported' };
    }
    newBoard[tr][tc] = piece;
    newBoard[fr][fc] = '';
    // King promotion
    if (player === 'r' && tr === 7) newBoard[tr][tc] = 'R';
    if (player === 'b' && tr === 0) newBoard[tr][tc] = 'B';
  }

  // Check if opponent has any moves left (win condition)
  const opp = player === 'r' ? 'b' : 'r';
  const oppOwn = opp === 'r' ? ['r','R'] : ['b','B'];
  let oppHasMoves = false;
  outer: for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!oppOwn.includes(newBoard[r][c])) continue;
      const isKing = newBoard[r][c] === newBoard[r][c].toUpperCase() && newBoard[r][c] !== newBoard[r][c].toLowerCase();
      const dirs = opp === 'r'
        ? (isKing ? [[-1,-1],[-1,1],[1,-1],[1,1]] : [[1,-1],[1,1]])
        : (isKing ? [[-1,-1],[-1,1],[1,-1],[1,1]] : [[-1,-1],[-1,1]]);
      for (const [dr,dc] of dirs) {
        const nr = r+dr, nc = c+dc;
        const jr = r+2*dr, jc = c+2*dc;
        if (nr>=0&&nr<8&&nc>=0&&nc<8&&newBoard[nr][nc]==='') { oppHasMoves=true; break outer; }
        if (jr>=0&&jr<8&&jc>=0&&jc<8&&newBoard[jr][jc]===''&&
            (opp==='r'?['b','B']:['r','R']).includes(newBoard[nr][nc])) { oppHasMoves=true; break outer; }
      }
    }
  }

  const gameOver = !oppHasMoves;
  const winner = gameOver ? player : null;
  const reason = gameOver ? 'no_moves' : null;
  let signature = null;

  if (gameOver && matchId) {
    signature = signResult(matchId, winner, reason);
    await db.ref('settlement/' + matchId + '/pending').set({
      winner, reason, signature, decidedAt: Date.now()
    });
  }

  await db.ref('relay/' + matchId + '/moves').push({
    player: playerId, move: mv, ts: Date.now(), validated: true
  });

  return { valid: true, board: newBoard, gameOver, winner, reason, signature };
});

// ── TicTacToe move validator ──────────────────────────────────────────────
exports.validateTicTacToeMove = functions.https.onCall(async (data, context) => {
  const { matchId, board, cell, player, playerId } = data;
  // board: 9-element array of '' | 'X' | 'O'
  // cell: 0–8, player: 'X' | 'O'
  if (typeof cell === 'undefined' || !board || !player) {
    return { valid: false, error: 'Missing cell, board, or player' };
  }
  if (cell < 0 || cell > 8) return { valid: false, error: 'Cell out of range' };
  if (board[cell] !== '' && board[cell] !== null && board[cell] !== undefined) {
    return { valid: false, error: 'Cell already occupied' };
  }

  const newBoard = [...board];
  newBoard[cell] = player;

  const WIN_LINES = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];

  let winner = null;
  for (const [a,b,c] of WIN_LINES) {
    if (newBoard[a] && newBoard[a] === newBoard[b] && newBoard[b] === newBoard[c]) {
      winner = newBoard[a];
      break;
    }
  }

  const full = newBoard.every(c => c !== '' && c !== null && c !== undefined);
  const draw = !winner && full;
  const gameOver = !!winner || draw;
  const finalWinner = winner || (draw ? 'draw' : null);
  const reason = winner ? 'win' : (draw ? 'draw' : null);
  let signature = null;

  if (gameOver && matchId) {
    signature = signResult(matchId, finalWinner, reason);
    await db.ref('settlement/' + matchId + '/pending').set({
      winner: finalWinner, reason, signature, decidedAt: Date.now()
    });
  }

  await db.ref('relay/' + matchId + '/moves').push({
    player: playerId, cell, ts: Date.now(), validated: true
  });

  return { valid: true, board: newBoard, gameOver, winner: finalWinner, reason, signature };
});

// ── Resign handler ────────────────────────────────────────────────────────
exports.processResign = functions.https.onCall(async (data, context) => {
  const { matchId, resigningAddress } = data;
  if (!matchId || !resigningAddress) return { success: false, error: 'Missing params' };

  // Read match to find opponent (winner)
  const snap = await db.ref('matches/' + matchId).get();
  if (!snap.exists()) return { success: false, error: 'Match not found' };
  const match = snap.val();
  const players = match.players || {};
  const winner = (players.creatorAddrFull === resigningAddress)
    ? players.opponentAddrFull
    : players.creatorAddrFull;

  if (!winner) return { success: false, error: 'Cannot determine winner' };

  const sig = signResult(matchId, winner, 'resign');
  await db.ref('settlement/' + matchId + '/pending').set({
    winner,
    reason: 'resign',
    signature: sig,
    resignedBy: resigningAddress,
    decidedAt: Date.now()
  });
  await db.ref('relay/' + matchId + '/result').set({
    type: 'resign',
    reason: 'resign',
    resignedBy: resigningAddress,
    winner,
    ts: Date.now()
  });
  await db.ref('matches/' + matchId + '/info/status').set('resigned');

  return { success: true, winner, signature: sig };
});

// ── Settlement daemon trigger ────────────────────────────────────────────
exports.onSettlementPending = functions.database
  .ref('settlement/{matchId}/pending')
  .onCreate(async (snap, context) => {
    const { matchId } = context.params;
    const data = snap.val();
    console.log('[HTP Oracle] Settlement pending:', matchId, data.winner, data.reason);
    // Clients watch this path and call settleMatchPayout themselves
    // Oracle just ensures the record exists and is signed
    return null;
  });
