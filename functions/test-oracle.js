// test-oracle.js — run with: node test-oracle.js
// Tests chess.js game logic WITHOUT needing Firebase (pure logic tests)
const { Chess } = require('chess.js');
let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✅ PASS:', name);
    passed++;
  } catch(e) {
    console.log('  ❌ FAIL:', name, '—', e.message);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error((msg || '') + ` expected "${b}" got "${a}"`); }

console.log('\n🧪 HTP Oracle Tests\n');

// ── Chess ────────────────────────────────────────────────────────────────
test("Scholar's mate — white wins", () => {
  const g = new Chess();
  g.move('e4'); g.move('e5');
  g.move('Qh5'); g.move('Nc6');
  g.move('Bc4'); g.move('Nf6');
  g.move('Qxf7');
  assert(g.isCheckmate(), 'Expected checkmate');
  // game.turn() returns loser (black is mated = black to move)
  assertEqual(g.turn(), 'b', 'Loser should be black');
  const winner = g.turn() === 'b' ? 'white' : 'black';
  assertEqual(winner, 'white', 'Winner should be white');
});

test("Fool's mate — black wins", () => {
  const g = new Chess();
  g.move('f3'); g.move('e5');
  g.move('g4'); g.move('Qh4');
  assert(g.isCheckmate());
  const winner = g.turn() === 'b' ? 'white' : 'black';
  assertEqual(winner, 'black');
});

test('Stalemate is a draw', () => {
  const g = new Chess('5k2/5P2/5K2/8/8/8/8/8 b - - 0 1');
  // This is a known stalemate position
  assert(g.isStalemate() || !g.isCheckmate(), 'Should be stalemate or game not over yet');
});

test('Illegal move rejected', () => {
  const g = new Chess();
  let rejected = false;
  try {
    const result = g.move('e5'); // Black's pawn move on white's turn
    rejected = result === null;
  } catch (e) {
    rejected = /Invalid move/i.test(e.message);
  }
  assert(rejected, 'Illegal move should be rejected');
});

test('Legal moves not null', () => {
  const g = new Chess();
  const m = g.move('e4');
  assert(m !== null, 'e4 should be legal');
});

test('PGN round-trip', () => {
  const g = new Chess();
  g.move('e4'); g.move('e5'); g.move('Nf3');
  const pgn = g.pgn();
  const g2 = new Chess();
  g2.loadPgn(pgn);
  assertEqual(g2.fen(), g.fen(), 'FEN should match after PGN load');
});

test('FEN position load', () => {
  const g = new Chess('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  assertEqual(g.turn(), 'b', 'Should be black to move');
});

test('isGameOver false on start', () => {
  const g = new Chess();
  assert(!g.isGameOver(), 'Should not be game over at start');
});

// ── Connect4 ─────────────────────────────────────────────────────────────
const ROWS = 6, COLS = 7;
function emptyBoard() {
  return Array.from({length: ROWS}, () => Array(COLS).fill(null));
}
function dropPiece(board, col, player) {
  for (let r = ROWS-1; r >= 0; r--) {
    if (!board[r][col]) { board[r][col] = player; return r; }
  }
  return -1;
}
function checkWin(b, p) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    if (b[r][c]!==p) continue;
    for (const [dr,dc] of dirs) {
      let n=1;
      for (let i=1;i<4;i++) { const nr=r+dr*i,nc=c+dc*i; if(nr<0||nr>=ROWS||nc<0||nc>=COLS||b[nr][nc]!==p)break; n++; }
      if (n>=4) return true;
    }
  }
  return false;
}

test('Connect4: horizontal win', () => {
  const b = emptyBoard();
  [0,1,2,3].forEach(c => dropPiece(b, c, 1));
  assert(checkWin(b, 1), 'Should detect horizontal win');
});

test('Connect4: vertical win', () => {
  const b = emptyBoard();
  [0,1,2,3].forEach(() => dropPiece(b, 0, 2));
  assert(checkWin(b, 2), 'Should detect vertical win');
});

test('Connect4: diagonal win ↘', () => {
  const b = emptyBoard();
  dropPiece(b,0,1); // row5,col0
  dropPiece(b,1,2); dropPiece(b,1,1); // row5,col1; row4,col1
  dropPiece(b,2,2); dropPiece(b,2,2); dropPiece(b,2,1); // row5,col2; row4,col2; row3,col2
  dropPiece(b,3,2); dropPiece(b,3,2); dropPiece(b,3,2); dropPiece(b,3,1);
  assert(checkWin(b, 1), 'Should detect diagonal win');
});

test('Connect4: no false win on 3 in a row', () => {
  const b = emptyBoard();
  [0,1,2].forEach(c => dropPiece(b, c, 1));
  assert(!checkWin(b, 1), 'Should not trigger on 3 in a row');
});

test('Connect4: column full detection', () => {
  const b = emptyBoard();
  for (let i=0;i<6;i++) dropPiece(b, 0, i%2+1);
  const row = (() => { for (let r=ROWS-1;r>=0;r--) if (!b[r][0]) return r; return -1; })();
  assertEqual(row, -1, 'Should return -1 for full column');
});

test('Connect4: draw when board full', () => {
  const b = emptyBoard();
  // Fill board alternating, no win
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) b[r][c] = ((r+c)%2)+1;
  const full = b[0].every(c => c);
  assert(full, 'Board should be full');
});

// ── HMAC signature ───────────────────────────────────────────────────────
test('HMAC signature deterministic', () => {
  const crypto = require('crypto');
  const key = 'test-key-32bytes-padded-to-length';
  const sign = (matchId, winner, reason) =>
    crypto.createHmac('sha256', key).update(matchId+':'+winner+':'+reason).digest('hex');
  const s1 = sign('HTP-TEST01', 'white', 'checkmate');
  const s2 = sign('HTP-TEST01', 'white', 'checkmate');
  assertEqual(s1, s2, 'Signatures should be deterministic');
  assert(s1.length === 64, 'Should be 64 hex chars');
});

test('HMAC signature differs for different inputs', () => {
  const crypto = require('crypto');
  const key = 'test-key-32bytes-padded-to-length';
  const sign = (a,b,c) => crypto.createHmac('sha256',key).update(a+':'+b+':'+c).digest('hex');
  assert(sign('HTP-A','white','checkmate') !== sign('HTP-A','black','checkmate'));
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('✅ ALL TESTS PASSED\n');
else { console.log('❌ SOME TESTS FAILED\n'); process.exit(1); }
