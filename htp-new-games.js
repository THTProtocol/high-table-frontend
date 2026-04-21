// htp-new-games.js — Backgammon, RPS, Coin Flip, Word Duel lobby integration
(function(W) {
'use strict';

W.HTP_NEW_GAMES = {
  backgammon: { name: 'Backgammon', icon: 'B', minStake: 10, desc: 'Standard rules, pip, hit, bear-off' },
  rps:        { name: 'Rock Paper Scissors', icon: 'R', minStake: 5, desc: 'Best-of-3, commit-reveal' },
  coinflip:   { name: 'Coin Flip', icon: 'C', minStake: 1, desc: 'Block-hash entropy commit-reveal' },
  wordduel:   { name: 'Word Duel', icon: 'W', minStake: 5, desc: '5-letter timed, block-hash seeded' }
};

W.HTP_GAMES_LIST = ['chess','checkers','connect4','backgammon','rps','coinflip','wordduel'];

})(window);
