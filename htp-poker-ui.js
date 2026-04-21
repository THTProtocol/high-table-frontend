// htp-poker-ui.js — Poker table UI (pure JS engine, WASM swap-in later)
(function(W) {
'use strict';

var pokerUI = { initialized: false, matchId: null, stake: 0, isCreator: false, seed: 0 };

var SUITS = ['\u2660', '\u2665', '\u2663', '\u2666']; // spades, hearts, clubs, diamonds
var RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function decodeCard(c) { return { rank: RANKS[c.rank - 2] || '?', suit: SUITS[c.suit] || '?', rankVal: c.rank }; }

function cardHtml(c, hidden) {
  if (hidden) return '<div style="width:36px;height:52px;background:#1a1a2e;border-radius:4px;border:1px solid #333"></div>';
  var d = decodeCard(c);
  var color = (c.suit === 1 || c.suit === 3) ? '#e74c3c' : '#eee';
  return '<div style="width:36px;height:52px;background:#f5f5f5;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:' + color + '">' + d.rank + d.suit + '</div>';
}

function buildDeck(seed) {
  var deck = [];
  for (var s = 0; s < 4; s++) for (var r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
  var next = seed;
  for (var i = 51; i > 0; i--) {
    next = (next * 1103515245 + 12345) >>> 0;
    var j = next % (i + 1);
    var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
  }
  return deck;
}

var state = {
  deck: [], deckIdx: 0, hole0: [], hole1: [], community: [],
  pot: 0, bets: [0, 0], folded: [false, false], winner: null,
  phase: 'idle' // idle, bet, preflop, flop, turn, river, showdown, complete
};

function resetTable(seed, stake) {
  state.deck = buildDeck(seed);
  state.deckIdx = 0; state.hole0 = []; state.hole1 = [];
  state.community = []; state.pot = 0; state.bets = [0, 0];
  state.folded = [false, false]; state.winner = null; state.phase = 'idle';
  pokerUI.stake = stake;
}

function dealCard() { return state.deck[state.deckIdx++]; }
function dealInitial() {
  state.hole0.push(dealCard()); state.hole1.push(dealCard());
  state.hole0.push(dealCard()); state.hole1.push(dealCard());
  state.phase = 'preflop';
}
function dealFlop()  { for (var i=0;i<3;i++) state.community.push(dealCard()); state.phase = 'flop'; }
function dealTurn()  { state.community.push(dealCard()); state.phase = 'turn'; }
function dealRiver() { state.community.push(dealCard()); state.phase = 'river'; }

function fmtKAS(sompi) {
  if (typeof sompi !== 'number' && typeof sompi !== 'bigint') return '--';
  var n = Number(sompi);
  return (n / 1e8).toFixed(2) + ' KAS';
}

function renderPoker() {
  var ov = document.getElementById('pokerOverlay');
  if (!ov) return;
  var showHole0 = state.phase !== 'idle' && state.phase !== 'bet';
  var showCom = state.community.length > 0;
  var disableButtons = state.phase === 'idle' || state.phase === 'complete';

  var hole0Html = state.hole0.map(function(c) { return cardHtml(c); }).join('');
  var hole1Html = state.hole1.map(function(c) { return cardHtml(c, true); }).join(''); // opponent hidden
  var comHtml = state.community.map(function(c) { return cardHtml(c); }).join('');

  ov.innerHTML =
    '<div class="chess-overlay" style="background:rgba(8,12,20,0.95);z-index:88">' +
    '  <div style="max-width:700px;margin:0 auto;padding:20px;position:relative">' +
    '    <div style="position:absolute;top:16px;right:16px;cursor:pointer" onclick="closePokerOverlay()">✕</div>' +
    '    <div style="text-align:center;margin-bottom:16px">' +
    '      <div style="font-size:22px;font-weight:700;color:var(--gold)">Poker</div>' +
    '      <div style="font-size:12px;color:#777">ID: ' + (pokerUI.matchId || '---').slice(0, 12) + '</div>' +
    '    </div>' +
    '    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">' +
    '      <div>' +
    '        <div style="font-size:12px;color:#777;margin-bottom:4px">Opponent</div>' +
    '        <div class="poker-hand">' + hole1Html + '</div>' +
    '        <div style="font-size:11px;color:#555;margin-top:4px">Bet: ' + fmtKAS(state.bets[1]) + '</div>' +
    '      </div>' +
    '      <div style="text-align:center;min-width:120px">' +
    '        <div style="font-size:11px;color:#777;margin-bottom:4px">Pot</div>' +
    '        <div style="font-size:24px;font-weight:800;color:var(--gold)">' + fmtKAS(state.pot) + '</div>' +
    '      </div>' +
    '      <div>' +
    '        <div style="font-size:12px;color:#777;margin-bottom:4px">You</div>' +
    '        <div class="poker-hand">' + hole0Html + '</div>' +
    '        <div style="font-size:11px;color:#555;margin-top:4px">Bet: ' + fmtKAS(state.bets[0]) + '</div>' +
    '      </div>' +
    '    </div>' +
    '    <div style="text-align:center;margin-bottom:20px">' +
    '      <div style="font-size:12px;color:#777;margin-bottom:4px">Community</div>' +
    '      <div class="poker-community">' + comHtml + '</div>' +
    '    </div>' +
    '    <div style="text-align:center;margin-bottom:12px">' +
    '      <span style="font-size:14px;color:var(--muted);text-transform:uppercase;font-weight:700;letter-spacing:1px">' + state.phase + '</span>' +
    '    </div>' +
    '    <div class="poker-actions">' +
    '      <button class="chess-btn" onclick="pokerAction(\'check\')"' + (disableButtons?' disabled':'') + '>Check</button>' +
    '      <button class="chess-btn" onclick="pokerAction(\'call\')"' + (disableButtons?' disabled':'') + '>Call</button>' +
    '      <input id="pokerRaise" type="number" min="1" placeholder="Raise KAS" style="width:90px;background:rgba(10,15,30,0.6);border:1px solid #333;color:var(--text);padding:6px;border-radius:6px">' +
    '      <button class="chess-btn" onclick="pokerRaise()"' + (disableButtons?' disabled':'') + '>Raise</button>' +
    '      <button class="chess-btn chess-btn-danger" onclick="pokerAction(\'fold\')"' + (disableButtons?' disabled':'') + '>Fold</button>' +
    '    </div>' +
    '    <div class="poker-actions" style="margin-top:8px">' +
    (state.phase === 'idle' || state.phase === 'bet'
      ? '<button class="chess-btn" onclick="pokerDeal()">Deal</button>' +
        '<button class="chess-btn chess-btn-danger" onclick="pokerCancel()">Cancel / Refund</button>'
      : '') +
    (state.phase === 'preflop' ? '<button class="chess-btn" onclick="pokerNextStreet()">Flop</button>' : '') +
    (state.phase === 'flop'   ? '<button class="chess-btn" onclick="pokerNextStreet()">Turn</button>' : '') +
    (state.phase === 'turn'   ? '<button class="chess-btn" onclick="pokerNextStreet()">River</button>' : '') +
    (state.phase === 'river'  ? '<button class="chess-btn" onclick="pokerShowdown()">Showdown</button>' : '') +
    (state.phase === 'showdown' || state.phase === 'complete'
      ? '<button class="chess-btn" onclick="pokerSettle()">Settle</button>' : '') +
    '    </div>' +
    '  </div>' +
    '</div>';
}

W.pokerInit  = function(matchData) {
  var m = matchData || {};
  pokerUI.matchId = m.id || 'poker_' + Date.now();
  pokerUI.isCreator = m.isCreator || false;
  pokerUI.seed = m.seed || (Date.now() & 0xFFFFFFFF);
  resetTable(pokerUI.seed, parseFloat(m.stake || 10) * 1e8);
  if (!document.getElementById('pokerOverlay')) {
    var d = document.createElement('div'); d.id = 'pokerOverlay'; document.body.appendChild(d);
  }
  renderPoker();
  pokerUI.initialized = true;
};
W.pokerDeal = function() {
  if (state.phase !== 'idle' && state.phase !== 'bet') return;
  dealInitial();
  renderPoker();
};
W.pokerNextStreet = function() {
  if (state.phase === 'preflop') dealFlop();
  else if (state.phase === 'flop') dealTurn();
  else if (state.phase === 'turn') dealRiver();
  renderPoker();
};
W.pokerShowdown = function() {
  state.phase = 'complete';
  state.winner = Math.random() > 0.5 ? 0 : 1; // placeholder: real showdown uses WASM eval
  showToast(state.winner === 0 ? 'You win!' : 'Opponent wins!', state.winner === 0 ? 'success' : 'info');
  renderPoker();
};
W.pokerAction = function(act) {
  if (state.phase === 'idle' || state.phase === 'complete') return;
  var bb = 100000000; // 1 KAS
  if (act === 'check') { /* no-op */ }
  else if (act === 'call') { state.bets[0] += bb; state.pot += bb; }
  else if (act === 'fold') { state.folded[0] = true; state.winner = 1; state.phase = 'complete'; showToast('You folded — opponent wins', 'info'); }
  renderPoker();
};
W.pokerRaise = function() {
  var val = parseFloat(document.getElementById('pokerRaise').value);
  if (!val || val < 1) { showToast('Minimum raise: 1 KAS', 'warn'); return; }
  var amount = Math.round(val * 1e8);
  state.bets[0] += amount; state.pot += amount;
  renderPoker();
};
W.pokerCancel = function() {
  if (state.phase !== 'idle' && state.phase !== 'bet') return;
  showToast('Refund issued', 'success');
  closePokerOverlay();
};
W.pokerSettle = function() {
  var fee = Math.floor(state.pot * 0.02);
  var payout = state.pot - fee;
  showToast('Settlement: ' + fmtKAS(payout) + ' to winner, ' + fmtKAS(fee) + ' fee', 'success');
  closePokerOverlay();
};
W.closePokerOverlay = function() {
  var ov = document.getElementById('pokerOverlay'); if (ov) ov.innerHTML = '';
  pokerUI.initialized = false;
};
})(window);
