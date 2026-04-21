// htp-blackjack-ui.js — Blackjack table (pure JS engine, WASM swap-in later)
(function(W) {
'use strict';

var bjUI = { initialized: false, matchId: null, stake: 0, isCreator: false, seed: 0 };

var SUITS = ['\u2660', '\u2665', '\u2663', '\u2666'];
function cardRank(r) { return r===1?'A':r===11?'J':r===12?'Q':r===13?'K':String(r); }
function cardVal(c) { return c.rank>=11?10:c.rank===1?11:c.rank; }
function cardColor(s) { return s===1||s===3?'#e74c3c':'#eee'; }
function cardHtml(c, hidden) {
  if (hidden) return '<div style="width:36px;height:52px;background:repeating-linear-gradient(45deg,#1a1a2e,#1a1a2e 4px,#222 4px,#222 8px);border-radius:4px;border:1px solid #333"></div>';
  var rr = cardRank(c.rank);
  return '<div style="width:36px;height:52px;background:#f5f5f5;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:'+cardColor(c.suit)+'">'+rr+SUITS[c.suit]+'</div>';
}
function buildDeck(seed) {
  var deck=[];
  for (var s=0;s<4;s++) for (var r=1;r<=13;r++) deck.push({rank:r,suit:s});
  var next=seed;
  for (var i=51;i>0;i--) { next=(next*1103515245+12345)>>>0; var j=next%(i+1); var tmp=deck[i];deck[i]=deck[j];deck[j]=tmp;}
  return deck;
}

function handTotal(hand) {
  var total=0, aces=0;
  for (var i=0;i<hand.length;i++) { total+=cardVal(hand[i]); if (hand[i].rank===1) aces++; }
  while (total>21 && aces>0) { total-=10; aces--; }
  return total;
}
function isBust(hand) { return handTotal(hand)>21; }
function isBlackjack(hand) { return hand.length===2 && handTotal(hand)===21; }

var state = { phase:'idle', deck:[], deckIdx:0, player:[], dealer:[], result:null, doubled:false };

function resetTable(seed, stake) {
  state.deck=buildDeck(seed); state.deckIdx=0;
  state.player=[]; state.dealer=[]; state.result=null;
  state.phase='idle'; state.doubled=false;
  bjUI.stake = stake || 0;
}
function draw() { return state.deck[state.deckIdx++]; }
function fmtKAS(n) { if (typeof n==='bigint') n=Number(n); return (n/1e8).toFixed(2)+' KAS'; }

var PHASE_LABELS = { idle:'Place Your Bet', bet:'Place Your Bet', playing:'Your Turn', dealer:'Dealer Turn', complete:'Game Over' };

function renderBJ() {
  var ov = document.getElementById('blackjackOverlay');
  if (!ov) return;
  var dealerHidden = state.phase !== 'complete';
  var dealerCardsHtml = state.dealer.map(function(c,i) { return cardHtml(c, dealerHidden && i===0); }).join('');
  var playerCardsHtml = state.player.map(function(c) { return cardHtml(c); }).join('');

  ov.innerHTML =
    '<div class="chess-overlay" style="background:rgba(8,12,20,0.95);z-index:88">'+
    '  <div style="max-width:520px;margin:0 auto;padding:20px;position:relative">'+
    '    <div style="position:absolute;top:16px;right:16px;cursor:pointer" onclick="bjClose()">×</div>'+
    '    <div style="text-align:center;margin-bottom:16px">'+
    '      <div style="font-size:22px;font-weight:700;color:var(--gold)">Blackjack</div>'+
    '      <div style="font-size:12px;color:#777">ID: '+(bjUI.matchId||'---').slice(0,12)+'</div>'+
    '    </div>'+
    '    <div style="text-align:center;margin-bottom:8px;font-size:12px;color:#777">Dealer</div>'+
    '    <div class="bj-hand" style="justify-content:center;gap:6px;display:flex;margin-bottom:4px">'+dealerCardsHtml+'</div>'+
    '    <div style="text-align:center;font-size:18px;font-weight:700;color:#eee;margin-bottom:20px">'+
    (state.phase==='complete'?handTotal(state.dealer):(state.dealer.length>0?'??':'--'))+
    '    </div>'+

    '    <div style="text-align:center;margin-bottom:12px">'+
    '      <span style="font-size:13px;color:var(--muted);text-transform:uppercase;font-weight:700;letter-spacing:1px">'+PHASE_LABELS[state.phase]+'</span>'+
    '    </div>'+

    '    <div style="text-align:center;font-size:18px;font-weight:700;color:#eee;margin-bottom:4px">'+handTotal(state.player)+'</div>'+
    '    <div class="bj-hand" style="justify-content:center;gap:6px;display:flex;margin-bottom:4px">'+playerCardsHtml+'</div>'+
    '    <div style="text-align:center;margin-bottom:16px;font-size:12px;color:#777">You</div>'+

    (state.phase==='idle'||state.phase==='bet'?
      '    <div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-bottom:12px">'+
      '      <input id="bjBet" type="number" min="1" max="1000" value="'+(bjUI.stake/1e8||10)+'" style="width:80px;background:rgba(10,15,30,0.6);border:1px solid #333;color:var(--text);padding:6px;border-radius:6px"><span style="color:#777">KAS</span>'+
      '    </div>' +
      '    <div style="display:flex;justify-content:center;gap:8px">'+
      '      <button class="chess-btn" onclick="bjDeal()">Place Bet &amp; Deal</button>'+
      '      <button class="chess-btn chess-btn-danger" onclick="bjCancel()">Cancel / Refund</button>'+
      '    </div>' : '')+

    (state.phase==='playing'?
      '    <div style="display:flex;justify-content:center;gap:8px;margin-top:12px">'+
      '      <button class="chess-btn" onclick="bjHit()">Hit</button>'+
      '      <button class="chess-btn" onclick="bjStand()">Stand</button>'+
      '      <button class="chess-btn" onclick="bjDouble()">Double Down</button>'+
      '    </div>' : '')+

    (state.phase==='complete'?
      '    <div style="text-align:center;margin-top:16px">'+
      '      <div style="font-size:24px;font-weight:800;margin-bottom:8px;color:'+(state.result&&state.result.includes('Win')?'#2ecc71':'#e74c3c')+'">'+bjResultLabel()+'</div>'+
      '      <div style="font-size:14px;color:#bbb">Payout: '+fmtKAS(bjPayout())+'</div>'+
      '      <div style="font-size:12px;color:#555">Fee (2%): '+fmtKAS(Math.floor(bjGross()*0.02))+'</div>'+
      '      <button class="chess-btn" style="margin-top:12px" onclick="bjNewGame()">New Game</button>'+
      '      <button class="chess-btn" style="margin-top:8px" onclick="bjSettle()">Settle</button>'+
      '    </div>' : '')+

    '  </div>'+
    '</div>';
}

function bjResultLabel() {
  if (!state.result) return 'Game Over';
  if (state.result==='blackjack') return 'Blackjack!';
  return state.result;
}
function bjGross() {
  if (state.result==='Blackjack!') return Math.floor(bjUI.stake * 5 / 2);
  if (state.result==='Win!' || state.result==='You win!') return bjUI.stake * 2;
  if (state.result==='Push') return bjUI.stake;
  return 0;
}
function bjPayout() {
  var g=bjGross(); if (g===0) return 0; return g - Math.floor(g*0.02);
}

function dealerTurn() {
  state.phase='dealer';
  renderBJ();
  setTimeout(function(){
    while (handTotal(state.dealer)<17) { state.dealer.push(draw()); }
    finishHand();
  }, 400);
}
function finishHand() {
  var pt=handTotal(state.player), dt=handTotal(state.dealer);
  var pbj=isBlackjack(state.player), dbj=isBlackjack(state.dealer);
  if (pbj && !dbj) state.result='Blackjack!';
  else if (pbj && dbj) state.result='Push';
  else if (dbj) state.result='Dealer wins';
  else if (isBust(state.dealer)) state.result='Win!';
  else if (pt>dt) state.result='Win!';
  else if (dt>pt) state.result='Dealer wins';
  else state.result='Push';
  state.phase='complete';
  showToast(bjResultLabel(), state.result==='Dealer wins'?'info':'success');
  renderBJ();
}

W.bjInit = function(matchData) {
  var m=matchData||{};
  bjUI.matchId=m.id||'bj_'+Date.now();
  bjUI.isCreator=m.isCreator||false;
  bjUI.seed=m.seed||(Date.now()& 0xFFFFFFFF);
  resetTable(bjUI.seed, parseFloat(m.stake||10)*1e8);
  if (!document.getElementById('blackjackOverlay')) { var d=document.createElement('div'); d.id='blackjackOverlay'; document.body.appendChild(d); }
  renderBJ(); bjUI.initialized=true;
};
W.bjDeal = function() {
  if (state.phase!=='idle'&&state.phase!=='bet') return;
  var val=parseFloat(document.getElementById('bjBet').value);
  if (!val||val<1) { showToast('Minimum bet: 1 KAS','warn'); return; }
  bjUI.stake=Math.round(val*1e8);
  state.phase='playing';
  state.player.push(draw()); state.dealer.push(draw());
  state.player.push(draw()); state.dealer.push(draw());
  if (isBlackjack(state.player)) { finishHand(); return; }
  renderBJ();
};
W.bjHit = function() {
  if (state.phase!=='playing') return;
  state.player.push(draw());
  if (isBust(state.player)) { state.result='Dealer wins'; state.phase='complete'; renderBJ(); showToast('Bust!','info'); }
  else renderBJ();
};
W.bjStand = function() { if(state.phase!=='playing') return; dealerTurn(); };
W.bjDouble = function() {
  if (state.phase!=='playing') return;
  bjUI.stake*=2; state.player.push(draw()); state.doubled=true;
  if (isBust(state.player)) { state.result='Dealer wins'; state.phase='complete'; renderBJ(); showToast('Bust after double!','info'); }
  else dealerTurn();
};
W.bjCancel = function() { if (state.phase!=='idle'&&state.phase!=='bet') return; showToast('Refund issued','success'); bjClose(); };
W.bjNewGame = function() { resetTable(bjUI.seed, bjUI.stake); state.phase='bet'; renderBJ(); };
W.bjSettle = function() {
  var fee=Math.floor(bjGross()*0.02), payout=bjPayout();
  showToast('Settlement: '+fmtKAS(payout)+' to you, '+fmtKAS(fee)+' fee','success');
  bjClose();
};
W.bjClose = function() { var ov=document.getElementById('blackjackOverlay'); if(ov) ov.innerHTML=''; bjUI.initialized=false; };
})(window);
