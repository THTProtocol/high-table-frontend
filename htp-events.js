/* ============================================================
   HTP Skill Games - Complete Multiplayer Module (htp-skill-games.js)
   Drop-in fix: createMatchWithLobby + Firebase relay (no WS server needed)
   ============================================================ */

// ─── CREATE MATCH WITH LOBBY (the missing function) ───────────────

async function createMatchWithLobby() {
    if (!walletAddress) { showToast('Connect wallet first', 'error'); go('wallet'); return; }

    var gameEl = document.getElementById('sgGame');
    var timeEl = document.getElementById('sgTime');
    var stakeEl = document.getElementById('sgEsc');
    var seriesEl = document.getElementById('sgSeries');

    var game = gameEl ? gameEl.value : 'chess';
    var timeControl = timeEl ? timeEl.value : '5|0';
    var stake = stakeEl ? (parseFloat(stakeEl.value) || 5) : 5;  // reads live input
    var seriesLen = seriesEl ? parseInt(seriesEl.value) || 1 : 1;

    var stakeSompi = Math.round(stake * 1e8);
    if (!walletBalance || walletBalance.total < stakeSompi) {
        showToast('Insufficient balance. Need ' + stake + ' KAS', 'error');
        return;
    }
    var _stakeConfirm = parseFloat((document.getElementById('sgEsc')||{}).value) || stake;
if (!confirm('Create ' + game + ' match for ' + _stakeConfirm + ' KAS?\nTime: ' + timeControl + ' | Series: Bo' + seriesLen)) return;

    try {
        showToast('Creating match escrow...', 'info');
        var matchId = 'HTP-' + Date.now().toString(36).toUpperCase();
        
        // Match creation now handles escrow inside createLobbyMatch
        var match = await createLobbyMatch(game, timeControl, stake, seriesLen, matchId);
        
        if (!match.escrowAddress) throw new Error('Escrow generation failed');

        showToast('Sending ' + stake + ' KAS to escrow...', 'info');
        var stakeSompi = Math.round(stake * 1e8);
        var meta = {
  type: 'create', game: game, stake: String(stake),
  timeControl: timeControl, matchId: matchId, creator: walletAddress || ''
};
var payloadHex = Array.from(new TextEncoder().encode(JSON.stringify(meta)))
  .map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
var txId = await htpSendTx(match.escrowAddress, stakeSompi, { priorityFee: 0, payload: payloadHex, matchId: matchId, amount: stakeSompi });

// Lobby broadcast -- 1 sompi to HTP Lobby Address so all clients can discover this game
var LOBBY_ADDR = (window.activeNet === 'mainnet')
  ? 'kaspa:qza6ah0lfqf33c9m00ynkfeettuleluvnpyvmssm5pzz7llwy2ka5nkka4fel'
  : 'kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m';
try {
  await htpSendTx(LOBBY_ADDR, 20000000, { priorityFee: 0, payload: payloadHex }); // 0.2 KAS min UTXO
  console.log('[HTP] Lobby broadcast TX sent');
} catch(e) { console.warn('[HTP] Lobby broadcast failed (non-fatal):', e.message); }
        if (!txId) throw new Error('Escrow TX failed');

        match.escrowTxId = txId;
        if (typeof saveLobby === 'function') saveLobby();

        // Write full match info to Firebase so listenLobby sees it
        var db = (typeof firebase !== 'undefined') && firebase.database();
        if (db) {
            db.ref('matches/' + match.id + '/info').set({
                game: game,
                timeControl: timeControl,
                stake: stake,
                seriesLen: seriesLen,
                status: 'waiting',
                created: Date.now(),
                escrowAddress: match.escrowAddress,
                escrowTxId: txId
            });
            db.ref('matches/' + match.id + '/players').set({
                creator: walletAddress,
                creatorAddrFull: walletAddress,
                opponent: null,
                opponentAddrFull: null
            });
        }

        // Note: No direct write to /lobby here. Backend handles that via /matches watch or direct call.
        
        showToast('Match created! ' + stake + ' KAS locked. Share the link!', 'success');
        if (typeof refreshBalanceFromChain === 'function') setTimeout(refreshBalanceFromChain, 3000);
    } catch (e) {
    showToast('Match creation failed: ' + e.message, 'error');
    console.error('[HTP Skill] createMatchWithLobby error:', e);
    if (typeof matchId !== 'undefined' && matchId) {
      try { var _db=(typeof firebase!=='undefined')&&firebase.database(); if(_db){_db.ref('matches/'+matchId).remove();console.log('[HTP] Ghost cleaned:',matchId);} } catch(_e) {}
      if (window.matchLobby&&window.matchLobby.matches) window.matchLobby.matches=window.matchLobby.matches.filter(function(x){return x.id!==matchId;});
      try{if(typeof saveLobby==='function')saveLobby();}catch(_e){}
    }
  }
}

// ─── JOIN LOBBY MATCH ───────────────
async function joinLobbyMatch(matchId) {
    var m = matchLobby.matches.find(function (mm) { return mm.id === matchId; });
    if (!m || m.status !== "waiting") {
        showToast("Match no longer available", "error");
        return;
    }
    if (m.creator === matchLobby.myPlayerId) {
        showToast("Cannot join your own match", "error");
        return;
    }
    if (!walletAddress) {
        showToast("Connect wallet first", "error");
        return;
    }

    var escAddr = m.escrowAddress;

    if (!escAddr && typeof getMatchEscrow === "function") {
        var esc = getMatchEscrow(matchId);
        escAddr = esc ? esc.address : null;
    }

    if (!escAddr && window.htpFirebase && window.htpFirebase.getMatch) {
        try {
            var fm = await window.htpFirebase.getMatch(matchId);
            if (fm && fm.escrowAddress) escAddr = fm.escrowAddress;
        } catch (e) {
            console.warn("HTP Firebase getMatch failed:", e.message);
        }
    }

    if (!escAddr) {
        showToast("No escrow address for this match", "error");
        return;
    }

    // Now do the actual send:
    try {
        var sompi = Math.round(parseFloat(m.stake || m.stakeKas || m.escrowKas || 0) * 1e8);
        if (!walletBalance || walletBalance.total < sompi) {
            showToast('Insufficient balance. Need ' + m.stake + ' KAS', 'error');
            return;
        }
        if (!confirm('Join ' + m.game + ' match for ' + m.stake + ' KAS?')) return;

        showToast("Locking " + m.stake + " KAS in match escrow...", "info");

        var txId = await htpSendTx(escAddr, sompi, { priorityFee: 0, matchId: m.id, amount: sompi });
        if (!txId) {
            showToast("Join failed (no txId)", "error");
            return;
        }

        m.opponent = matchLobby.myPlayerId;
        m.opponentAddr = walletAddress.substring(0, 14) + "...";
        m.status = "active";
        m.joinTxId = txId;
        saveLobby();

        if (window.htpFirebase && window.htpFirebase.joinMatch) {
            window.htpFirebase.joinMatch(
                m.id,
                matchLobby.myPlayerId,
                walletAddress,
                walletAddress,
                txId
            );
        }

        if (typeof broadcastLobby === 'function') broadcastLobby({ type: 'match_joined', matchId: m.id, player: matchLobby.myPlayerId });
        if (typeof renderLobby === 'function') renderLobby();
        showToast("Matched! Launching game...", "success");
        setTimeout(function () { if (typeof playMatch === 'function') playMatch(m.id); else if (typeof previewMatch === 'function') previewMatch(m.id); }, 800);
    } catch (e) {
    showToast('Join failed: ' + e.message, 'error');
    console.error('[HTP Skill] joinLobbyMatch error:', e);
    if (matchId) {
      try { var _db2=(typeof firebase!=='undefined')&&firebase.database(); if(_db2){_db2.ref('matches/'+matchId+'/players/opponent').set(null);_db2.ref('matches/'+matchId+'/info/status').set('waiting');} } catch(_e) {}
    }
  }
}

// ─── CREATE LOBBY MATCH (Internal) ───────────────
async function createLobbyMatch(game, timeControl, stake, seriesLen, existingId) {
    var matchId = existingId || ('HTP-' + Date.now().toString(36).toUpperCase());
    
    var match = {
            stake: stake,
        id: matchId,
        game: game,
        timeControl: timeControl,
        stake: stake,
        seriesLen: seriesLen || 1,
        creator: matchLobby.myPlayerId,
        creatorAddr: (walletAddress || '').substring(0, 14) + '...',
        creatorAddrFull: walletAddress || '',
        opponent: null,
        opponentAddr: null,
        status: 'waiting',
        created: Date.now(),
        escrowAddress: null,
        escrowTxId: null
    };

    // Generate per-match escrow
    if (typeof generateMatchEscrow === 'function') {
        var escEntry = await generateMatchEscrow(match.id);
        match.escrowAddress = escEntry.address;
    }

    if (matchLobby && matchLobby.matches) {
        matchLobby.matches.push(match);
        if (typeof saveLobby === 'function') saveLobby();
    }

    // Persist to Firebase via backend if available
    if (window.htpFirebase && window.htpFirebase.createMatch) {
         window.htpFirebase.createMatch(match.id, matchLobby.myPlayerId, walletAddress, match);
    }

    if (typeof broadcastLobby === 'function') broadcastLobby({ type: 'match_created', matchId: match.id });
    if (typeof renderLobby === 'function') renderLobby();
    if (typeof startLobbyWatcher === 'function') startLobbyWatcher();
    
    return match;
}

window.createMatchWithLobby = createMatchWithLobby;
window.joinLobbyMatch = joinLobbyMatch;

// ─── CANCEL MATCH (creator only) ─────────────────────────────────────────
async function cancelLobbyMatch(matchId) {
    try {
        const db = window.htpFirebase && window.htpFirebase.db;
        if (!db) { showToast && showToast('Firebase not ready', 'error'); return; }

        // Verify caller is creator
        const snap = await db.ref('lobby/' + matchId).get();
        const m = snap.val();
        if (!m) { showToast && showToast('Match not found', 'error'); return; }

        const myAddr = window.htpAddress || window.walletAddress;
        if (m.creator && m.creator !== myAddr) {
            showToast && showToast('Only the creator can cancel', 'error');
            return;
        }

        if (m.status !== 'open' && m.status !== 'waiting') {
            showToast && showToast('Match already started or closed', 'error');
            return;
        }

        // TODO: if escrow was funded, refund via cancelMatchEscrow
        if (m.escrowAddress && typeof window.cancelMatchEscrow === 'function') {
            try {
                await window.cancelMatchEscrow({ matchId, escrowAddress: m.escrowAddress });
                console.log('[HTP] Escrow cancelled for', matchId);
            } catch (e) {
                console.warn('[HTP] Escrow cancel failed (may not be funded yet):', e.message);
            }
        }

        // Delete from Firebase
        await db.ref('lobby/' + matchId).remove();

        // Remove from local store
        if (window.htpMatches) delete window.htpMatches[matchId];
        if (window.openMatches) delete window.openMatches[matchId];

        showToast && showToast('Match cancelled', 'success');
        console.log('[HTP Skill] Match cancelled:', matchId);

        // Refresh lobby
        if (typeof renderLobby === 'function') renderLobby();
        document.dispatchEvent(new CustomEvent('htpLobbyCancelled', { detail: { matchId } }));

    } catch (e) {
        console.error('[HTP Skill] cancelLobbyMatch error:', e);
        showToast && showToast('Cancel failed: ' + e.message, 'error');
    }
}

window.cancelLobbyMatch = cancelLobbyMatch;

window.createLobbyMatch = createLobbyMatch;


// ─── FIREBASE MOVE RELAY (replaces WebSocket relay) ────────────────
(function () {
    var fbRelay = { matchId: null, playerId: null, gameType: null, unsubscribe: null, lastMoveTs: 0 };

    window.connectRelay = function (matchId, gameType) {
        if (fbRelay.unsubscribe) { fbRelay.unsubscribe(); fbRelay.unsubscribe = null; }

        fbRelay.matchId = matchId;
        fbRelay.gameType = gameType;
        fbRelay.playerId = matchLobby.myPlayerId;
        fbRelay.lastMoveTs = Date.now();

        var ref = firebase.database().ref('relay/' + matchId);

        ref.child('presence/' + fbRelay.playerId).set({ online: true, joined: Date.now() });
        ref.child('presence/' + fbRelay.playerId).onDisconnect().set({ online: false, left: Date.now() });

        var movesRef = ref.child('moves');
        var handler = movesRef.orderByChild('ts').startAt(Date.now()).on('child_added', function (snap) {
            var msg = snap.val();
            if (!msg || msg.player === fbRelay.playerId) return;
            if (msg.ts <= fbRelay.lastMoveTs) return;
            fbRelay.lastMoveTs = msg.ts;
            handleRelayMessage(msg);
        });

        fbRelay.unsubscribe = function () {
            movesRef.off('child_added', handler);
            ref.child('presence/' + fbRelay.playerId).set({ online: false, left: Date.now() });
        };

        ref.child('presence').on('value', function (snap) {
            var p = snap.val();
            if (!p) return;
            var others = Object.keys(p).filter(function (k) { return k !== fbRelay.playerId; });
            for (var i = 0; i < others.length; i++) {
                if (p[others[i]].online) {
                    showToast('Opponent connected!', 'success');
                    break;
                }
            }
        });

        if (typeof htpRelay !== 'undefined') {
            htpRelay.connected = true;
            htpRelay.matchId = matchId;
            htpRelay.gameType = gameType;
        }
        console.log('[HTP Relay] Firebase relay connected for', matchId);
        showToast('Connected to game relay', 'success');
    };

    window.relaySend = function (msg) {
        if (!fbRelay.matchId) { console.warn('[HTP Relay] No active match'); return; }
        msg.player = fbRelay.playerId;
        msg.ts = Date.now();
        firebase.database().ref('relay/' + fbRelay.matchId + '/moves').push(msg);
    };

    window.hookMoveRelay = function (matchId, gameType) {
        connectRelay(matchId, gameType);

        if (gameType === 'chess' && window.chessSquareClick && !window.chessSquareClick._fbRelayed) {
            var orig = window.chessSquareClick;
            window.chessSquareClick = function (sq) {
                var prevFen = chessGame.fen();
                orig(sq);
                var newFen = chessGame.fen();
                if (prevFen !== newFen) {
                    relaySend({
                        type: 'move', game: 'chess', fen: newFen, move: chessUI.lastMove,
                        wasCapture: (prevFen.split(' ')[0].length > newFen.split(' ')[0].length),
                        capturedW: chessUI.capturedW, capturedB: chessUI.capturedB
                    });
                }
            };
            window.chessSquareClick._fbRelayed = true;
        }
    };

    window.handleMatchGameOver = async function (reason, winnerColor) {
        var match = matchLobby.activeMatch;
        if (!match) return;

        var iAmCreator = (match.creator === matchLobby.myPlayerId);
        var seed = 0;
        var idStr = match.id.replace('HTP-', '');
        for (var i = 0; i < idStr.length; i++) seed += idStr.charCodeAt(i);
        var creatorFirst = (seed % 2 === 0);

        var creatorColor, opponentColor;
        if (match.game === 'chess') {
            creatorColor = creatorFirst ? 'w' : 'b';
            opponentColor = creatorFirst ? 'b' : 'w';
        } else {
            creatorColor = creatorFirst ? 1 : 2;
            opponentColor = creatorFirst ? 2 : 1;
        }

        var iWon = false;
        if (reason === 'resign') {
            iWon = true;
        } else if (reason === 'checkmate' || reason === 'timeout') {
            iWon = (winnerColor === (iAmCreator ? creatorColor : opponentColor));
        }

        var stake = parseFloat(match.stake) || 5;
        var totalPot = stake * 2;

        if (iWon) {
            showGameOverOverlay('YOU WIN!', '+' + totalPot.toFixed(2) + ' KAS', '49e8c2', match);
            showToast('Victory! ' + totalPot + ' KAS payout processing...', 'success');
            try {
                var txId = await sendFromEscrow(match.id, walletAddress);
                if (txId) {
                    showToast('Payout TX: ' + txId.substring(0, 16) + '...', 'success');
                    if (typeof addToHistory === 'function') addToHistory({ type: 'matchwin', amount: totalPot, game: match.game, matchId: match.id, txId: txId, timestamp: Date.now() });
                }
            } catch (e) {
                console.error('[HTP] Payout failed:', e);
                showToast('Payout error: ' + e.message, 'error');
            }
        } else {
            showGameOverOverlay('YOU LOSE', '-' + stake.toFixed(2) + ' KAS', 'ef4444', match);
        }

        match.status = 'finished';
        match.result = iWon ? 'win' : 'loss';
        match.finishedAt = Date.now();
        saveLobby();

        try {
            // firebase.database().ref('lobby/' + match.id + '/status').set('finished');
            firebase.database().ref('matches/' + match.id + '/info/status').set('finished');
            firebase.database().ref('relay/' + match.id + '/result').set({ winner: iWon ? matchLobby.myPlayerId : 'opponent', reason: reason, ts: Date.now() });
        } catch (e) { }

        if (fbRelay.unsubscribe) { fbRelay.unsubscribe(); fbRelay.unsubscribe = null; }
        if (typeof renderLobby === 'function') renderLobby();
        if (typeof refreshBalanceFromChain === 'function') setTimeout(refreshBalanceFromChain, 3000);
    };

    window.showGameOverOverlay = function (title, subtitle, color, match) {
        var existing = document.getElementById('gameOverOverlay');
        if (existing) existing.remove();

        var ov = document.createElement('div');
        ov.id = 'gameOverOverlay';
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;animation:fadeIn .3s ease';
        ov.innerHTML = '<div style="text-align:center;padding:40px">' +
            '<div style="font-size:64px;margin-bottom:16px;animation:pulse .5s ease 3">' + (color === '49e8c2' ? '\u{1F3C6}' : '\u{1F480}') + '</div>' +
            '<div style="font-size:28px;font-weight:800;color:#' + color + ';margin-bottom:8px">' + title + '</div>' +
            '<div style="font-size:20px;color:#' + color + ';margin-bottom:24px;font-weight:600">' + subtitle + '</div>' +
            (match ? '<div style="font-size:12px;color:#888;margin-bottom:24px">' + match.game + ' \u00B7 ' + match.timeControl + ' \u00B7 ' + match.stake + ' KAS</div>' : '') +
            '<button class="chess-btn" onclick="this.parentElement.parentElement.remove();go(\'skillGames\')" style="padding:12px 32px;font-size:14px">Back to Lobby</button>' +
            '</div>';
        document.body.appendChild(ov);
        if (typeof playChessSound === 'function') playChessSound(color === '49e8c2' ? 'victory' : 'defeat');
    };

    window.resignMatch = function () {
        if (!matchLobby.activeMatch) return;
        if (!confirm('Resign this match? You will lose your ' + matchLobby.activeMatch.stake + ' KAS stake.')) return;

        relaySend({ type: 'resign', game: matchLobby.activeMatch.game });

        var match = matchLobby.activeMatch;
        var stake = parseFloat(match.stake) || 5;
        showGameOverOverlay('YOU RESIGNED', '-' + stake.toFixed(2) + ' KAS', 'ef4444', match);

        match.status = 'finished';
        match.result = 'loss';
        match.finishedAt = Date.now();
        saveLobby();
        if (typeof renderLobby === 'function') renderLobby();
    };
})();

// ─── HANDLE RELAY MESSAGES ────────────────────────────────────────
function handleRelayMessage(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'move') {
        if (msg.game === 'chess' && typeof chessGame !== 'undefined') {
            chessGame.load(msg.fen);
            if (msg.capturedW) chessUI.capturedW = msg.capturedW;
            if (msg.capturedB) chessUI.capturedB = msg.capturedB;
            if (typeof playChessSound === 'function') playChessSound(msg.wasCapture ? 'capture' : 'move');
            if (typeof renderChessBoard === 'function') renderChessBoard();
            if (typeof renderChessOverlay === 'function') renderChessOverlay();

            if (chessGame.in_checkmate()) {
                var winner = chessGame.turn() === 'w' ? 'b' : 'w';
                handleMatchGameOver('checkmate', winner);
            } else if (chessGame.in_stalemate() || chessGame.in_draw()) {
                handleMatchGameOver('draw', null);
            }
        } else if (msg.game === 'c4' || msg.game === 'connect4') {
            if (typeof applyC4Move === 'function') applyC4Move(msg.col, msg.side);
        } else if (msg.game === 'ck' || msg.game === 'checkers') {
            if (typeof applyCkMove === 'function') applyCkMove(msg.from, msg.to, msg.side);
        }
    } else if (msg.type === 'resign') {
        if (typeof chessUI !== 'undefined' && chessUI.timerInterval) clearInterval(chessUI.timerInterval);
        var myColor = typeof chessUI !== 'undefined' ? chessUI.playerColor : 1;
        handleMatchGameOver('resign', myColor);
    } else if (msg.type === 'chat') {
        showToast(msg.text, 'info');
    }
}

// ─── CONNECT4 MULTIPLAYER LOGIC ────────────────────────────────────
(function () {
    var C4 = { ROWS: 6, COLS: 7, board: null, turn: 1, myColor: 1, matchId: null, timeLeft: [0, 0], timerInterval: null, gameOver: false };

    window.startConnect4Game = function (opts) {
        C4.board = [];
        for (var r = 0; r < C4.ROWS; r++) { C4.board[r] = []; for (var c = 0; c < C4.COLS; c++) C4.board[r][c] = 0; }
        C4.turn = 1;
        C4.myColor = opts.side || 1;
        C4.matchId = opts.id;
        C4.gameOver = false;
        var timeSec = parseInt(opts.time) || 200;
        C4.timeLeft = [timeSec, timeSec];
        renderC4Overlay();
        startC4Timer();
    };

    function checkC4Win(board, player) {
        for (var r = 0; r < 6; r++) for (var c = 0; c < 7; c++) {
            if (c + 3 < 7 && board[r][c] === player && board[r][c + 1] === player && board[r][c + 2] === player && board[r][c + 3] === player) return true;
            if (r + 3 < 6 && board[r][c] === player && board[r + 1][c] === player && board[r + 2][c] === player && board[r + 3][c] === player) return true;
            if (r + 3 < 6 && c + 3 < 7 && board[r][c] === player && board[r + 1][c + 1] === player && board[r + 2][c + 2] === player && board[r + 3][c + 3] === player) return true;
            if (r + 3 < 6 && c - 3 >= 0 && board[r][c] === player && board[r + 1][c - 1] === player && board[r + 2][c - 2] === player && board[r + 3][c - 3] === player) return true;
        }
        return false;
    }

    function dropC4(col) {
        if (C4.gameOver || C4.turn !== C4.myColor) return;
        for (var r = C4.ROWS - 1; r >= 0; r--) {
            if (C4.board[r][col] === 0) {
                C4.board[r][col] = C4.myColor;
                C4.turn = C4.myColor === 1 ? 2 : 1;
                relaySend({ type: 'move', game: 'c4', col: col, side: C4.myColor, row: r });
                if (typeof playChessSound === 'function') playChessSound('move');
                if (checkC4Win(C4.board, C4.myColor)) {
                    C4.gameOver = true;
                    handleMatchGameOver('connect4win', C4.myColor);
                }
                renderC4Board();
                return;
            }
        }
    }
    window.dropC4 = dropC4;

    window.applyC4Move = function (col, side) {
        for (var r = C4.ROWS - 1; r >= 0; r--) {
            if (C4.board[r][col] === 0) {
                C4.board[r][col] = side;
                C4.turn = side === 1 ? 2 : 1;
                if (typeof playChessSound === 'function') playChessSound('capture');
                if (checkC4Win(C4.board, side)) {
                    C4.gameOver = true;
                    handleMatchGameOver('connect4win', side);
                }
                renderC4Board();
                return;
            }
        }
    };

    function startC4Timer() {
        if (C4.timerInterval) clearInterval(C4.timerInterval);
        C4.timerInterval = setInterval(function () {
            if (C4.gameOver) { clearInterval(C4.timerInterval); return; }
            var idx = C4.turn === 1 ? 0 : 1;
            C4.timeLeft[idx]--;
            if (C4.timeLeft[idx] <= 0) {
                C4.gameOver = true;
                clearInterval(C4.timerInterval);
                handleMatchGameOver('timeout', C4.turn === 1 ? 2 : 1);
            }
            updateC4Timers();
        }, 1000);
    }

    function fmtTime(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
    function updateC4Timers() {
        var t1 = document.getElementById('c4timer1');
        var t2 = document.getElementById('c4timer2');
        if (t1) t1.textContent = fmtTime(C4.timeLeft[0]);
        if (t2) t2.textContent = fmtTime(C4.timeLeft[1]);
    }

    function renderC4Board() {
        var el = document.getElementById('c4board');
        if (!el) { renderC4Overlay(); return; }
        var html = '';
        for (var r = 0; r < C4.ROWS; r++) {
            html += '<div style="display:flex;justify-content:center">';
            for (var c = 0; c < C4.COLS; c++) {
                var fill = C4.board[r][c] === 1 ? '#dc2626' : C4.board[r][c] === 2 ? '#f59e0b' : 'rgba(255,255,255,.05)';
                var border = C4.board[r][c] === 0 ? '2px solid rgba(255,255,255,.08)' : '2px solid rgba(0,0,0,.2)';
                var cursor = (C4.turn === C4.myColor && !C4.gameOver) ? 'pointer' : 'default';
                html += '<div onclick="dropC4(' + c + ')" style="width:48px;height:48px;margin:3px;border-radius:50%;background:' + fill + ';border:' + border + ';cursor:' + cursor + ';transition:background .2s"></div>';
            }
            html += '</div>';
        }
        el.innerHTML = html;
        updateC4Timers();
        var turnEl = document.getElementById('c4turn');
        if (turnEl) {
            if (C4.gameOver) turnEl.textContent = 'Game Over';
            else turnEl.textContent = C4.turn === C4.myColor ? 'Your turn' : "Opponent's turn";
        }
    }

    function renderC4Overlay() {
        var existing = document.getElementById('c4overlay');
        if (existing) existing.remove();
        var ov = document.createElement('div');
        ov.id = 'c4overlay';
        ov.className = 'chess-overlay';
        var myLabel = C4.myColor === 1 ? 'Red' : 'Yellow';
        ov.innerHTML = '<div class="chess-container" style="max-width:420px">' +
            '<div class="chess-header"><h2>Connect 4</h2><button class="chess-close" onclick="resignMatch()">X</button></div>' +
            '<div style="padding:16px">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:12px">' +
            '<div style="font-size:12px;color:#888">You: ' + myLabel + '</div>' +
            '<div id="c4turn" style="font-size:12px;font-weight:700;color:#49e8c2">' + (C4.turn === C4.myColor ? 'Your turn' : "Opponent\'s turn") + '</div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
            '<span id="c4timer1" style="font-family:monospace;color:#dc2626;font-weight:700">' + fmtTime(C4.timeLeft[0]) + '</span>' +
            '<span id="c4timer2" style="font-family:monospace;color:#f59e0b;font-weight:700">' + fmtTime(C4.timeLeft[1]) + '</span>' +
            '</div>' +
            '<div id="c4board" style="background:#1a3a5c;border-radius:12px;padding:8px;margin-bottom:16px"></div>' +
            '<div style="text-align:center"><button class="chess-btn chess-btn-danger" onclick="resignMatch()" style="font-size:12px;padding:8px 20px">Resign</button></div>' +
            '</div></div>';
        document.body.appendChild(ov);
        renderC4Board();
    }
})();

// ─── CHECKERS MULTIPLAYER LOGIC ────────────────────────────────────
(function () {
    var CK = { board: null, turn: 1, myColor: 1, matchId: null, selected: null, legalTargets: [], timeLeft: [0, 0], timerInterval: null, gameOver: false };

    function initCkBoard() {
        CK.board = [];
        for (var r = 0; r < 8; r++) {
            CK.board[r] = []; for (var c = 0; c < 8; c++) {
                if ((r + c) % 2 === 1) {
                    if (r < 3) CK.board[r][c] = 3;
                    else if (r > 4) CK.board[r][c] = 1;
                    else CK.board[r][c] = 0;
                } else CK.board[r][c] = 0;
            }
        }
    }

    window.startCheckersGame = function (opts) {
        CK.myColor = opts.side || 1;
        CK.matchId = opts.id;
        CK.gameOver = false;
        CK.turn = 1;
        CK.selected = null;
        CK.legalTargets = [];
        var timeSec = parseInt(opts.time) * 60 || 300;
        CK.timeLeft = [timeSec, timeSec];
        initCkBoard();
        renderCkOverlay();
        startCkTimer();
    };

    function getCkMoves(board, r, c) {
        var piece = board[r][c];
        if (!piece) return { moves: [], jumps: [] };
        var color = (piece === 1 || piece === 2) ? 1 : 3;
        var isKing = (piece === 2 || piece === 4);
        var dirs = [];
        if (color === 1 || isKing) dirs.push([-1, -1], [-1, 1]);
        if (color === 3 || isKing) dirs.push([1, -1], [1, 1]);
        var moves = [], jumps = [];
        for (var d = 0; d < dirs.length; d++) {
            var dr = dirs[d][0], dc = dirs[d][1];
            var nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                if (board[nr][nc] === 0) moves.push([nr, nc]);
                else {
                    var tColor = (board[nr][nc] === 1 || board[nr][nc] === 2) ? 1 : 3;
                    if (tColor !== color) {
                        var jr = nr + dr, jc = nc + dc;
                        if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 && board[jr][jc] === 0) jumps.push([jr, jc, nr, nc]);
                    }
                }
            }
        }
        return { moves: moves, jumps: jumps };
    }

    function hasAnyJumps(board, color) {
        for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
            var p = board[r][c]; if (!p) continue;
            if (((p === 1 || p === 2) ? 1 : 3) === color && getCkMoves(board, r, c).jumps.length > 0) return true;
        }
        return false;
    }

    function hasAnyMoves(board, color) {
        for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
            var p = board[r][c]; if (!p) continue;
            if (((p === 1 || p === 2) ? 1 : 3) !== color) continue;
            var m = getCkMoves(board, r, c);
            if (m.moves.length > 0 || m.jumps.length > 0) return true;
        }
        return false;
    }

    function ckClick(r, c) {
        if (CK.gameOver || CK.turn !== CK.myColor) return;
        var piece = CK.board[r][c];
        var myPieces = CK.myColor === 1 ? [1, 2] : [3, 4];

        if (myPieces.indexOf(piece) >= 0) {
            CK.selected = [r, c];
            var m = getCkMoves(CK.board, r, c);
            var forceJump = hasAnyJumps(CK.board, CK.myColor);
            CK.legalTargets = forceJump ? m.jumps : (m.jumps.length > 0 ? m.jumps : m.moves);
            renderCkBoard();
            return;
        }

        if (CK.selected) {
            for (var i = 0; i < CK.legalTargets.length; i++) {
                var t = CK.legalTargets[i];
                if (t[0] === r && t[1] === c) {
                    var sr = CK.selected[0], sc = CK.selected[1];
                    CK.board[r][c] = CK.board[sr][sc];
                    CK.board[sr][sc] = 0;
                    if (CK.myColor === 1 && r === 0) CK.board[r][c] = 2;
                    if (CK.myColor === 3 && r === 7) CK.board[r][c] = 4;
                    if (t.length === 4) CK.board[t[2]][t[3]] = 0;

                    relaySend({ type: 'move', game: 'ck', from: [sr, sc], to: [r, c], side: CK.myColor });
                    if (typeof playChessSound === 'function') playChessSound(t.length === 4 ? 'capture' : 'move');

                    if (t.length === 4 && getCkMoves(CK.board, r, c).jumps.length > 0) {
                        CK.selected = [r, c];
                        CK.legalTargets = getCkMoves(CK.board, r, c).jumps;
                        renderCkBoard();
                        return;
                    }

                    CK.turn = CK.myColor === 1 ? 3 : 1;
                    CK.selected = null;
                    CK.legalTargets = [];

                    if (!hasAnyMoves(CK.board, CK.turn)) {
                        CK.gameOver = true;
                        handleMatchGameOver('checkerswin', CK.myColor);
                    }
                    renderCkBoard();
                    return;
                }
            }
        }
    }
    window.ckClick = ckClick;

    window.applyCkMove = function (from, to, side) {
        CK.board[to[0]][to[1]] = CK.board[from[0]][from[1]];
        CK.board[from[0]][from[1]] = 0;
        if (Math.abs(to[0] - from[0]) === 2) {
            var jr = (from[0] + to[0]) / 2, jc = (from[1] + to[1]) / 2;
            CK.board[jr][jc] = 0;
        }
        if (side === 1 && to[0] === 0) CK.board[to[0]][to[1]] = 2;
        if (side === 3 && to[0] === 7) CK.board[to[0]][to[1]] = 4;

        CK.turn = side === 1 ? 3 : 1;
        if (typeof playChessSound === 'function') playChessSound(Math.abs(to[0] - from[0]) === 2 ? 'capture' : 'move');

        if (!hasAnyMoves(CK.board, CK.turn)) {
            CK.gameOver = true;
            handleMatchGameOver('checkerswin', side);
        }
        renderCkBoard();
    };

    function startCkTimer() {
        if (CK.timerInterval) clearInterval(CK.timerInterval);
        CK.timerInterval = setInterval(function () {
            if (CK.gameOver) { clearInterval(CK.timerInterval); return; }
            var idx = CK.turn === 1 ? 0 : 1;
            CK.timeLeft[idx]--;
            if (CK.timeLeft[idx] <= 0) {
                CK.gameOver = true;
                clearInterval(CK.timerInterval);
                handleMatchGameOver('timeout', CK.turn === 1 ? 3 : 1);
            }
            updateCkTimers();
        }, 1000);
    }

    function fmtTime(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
    function updateCkTimers() {
        var t1 = document.getElementById('cktimer1');
        var t2 = document.getElementById('cktimer2');
        if (t1) t1.textContent = fmtTime(CK.timeLeft[0]);
        if (t2) t2.textContent = fmtTime(CK.timeLeft[1]);
    }

    function renderCkBoard() {
        var el = document.getElementById('ckboard');
        if (!el) return;
        var html = '';
        var selR = CK.selected ? CK.selected[0] : -1, selC = CK.selected ? CK.selected[1] : -1;
        var targetSet = {};
        for (var i = 0; i < CK.legalTargets.length; i++) targetSet[CK.legalTargets[i][0] + ',' + CK.legalTargets[i][1]] = true;

        for (var r = 0; r < 8; r++) {
            html += '<div style="display:flex">';
            for (var c = 0; c < 8; c++) {
                var isDark = (r + c) % 2 === 1;
                var bg = isDark ? '#5c4033' : '#deb887';
                if (r === selR && c === selC) bg = 'rgba(73,232,194,.4)';
                if (targetSet[r + ',' + c]) bg = 'rgba(73,232,194,.25)';
                var piece = CK.board[r][c];
                var sym = '';
                if (piece === 1) sym = '<div style="width:36px;height:36px;border-radius:50%;background:#dc2626;border:3px solid #991b1b;margin:auto"></div>';
                if (piece === 2) sym = '<div style="width:36px;height:36px;border-radius:50%;background:#dc2626;border:3px solid #fbbf24;margin:auto;box-shadow:0 0 8px #fbbf24"></div>';
                if (piece === 3) sym = '<div style="width:36px;height:36px;border-radius:50%;background:#1a1a2e;border:3px solid #333;margin:auto"></div>';
                if (piece === 4) sym = '<div style="width:36px;height:36px;border-radius:50%;background:#1a1a2e;border:3px solid #fbbf24;margin:auto;box-shadow:0 0 8px #fbbf24"></div>';
                html += '<div onclick="ckClick(' + r + ',' + c + ')" style="width:44px;height:44px;background:' + bg + ';display:flex;align-items:center;justify-content:center;cursor:pointer">' + sym + '</div>';
            }
            html += '</div>';
        }
        el.innerHTML = html;
        updateCkTimers();
        var turnEl = document.getElementById('ckturn');
        if (turnEl) {
            if (CK.gameOver) turnEl.textContent = 'Game Over';
            else turnEl.textContent = CK.turn === CK.myColor ? 'Your turn' : "Opponent's turn";
        }
    }

    function renderCkOverlay() {
        var existing = document.getElementById('ckoverlay');
        if (existing) existing.remove();
        var ov = document.createElement('div');
        ov.id = 'ckoverlay';
        ov.className = 'chess-overlay';
        var myLabel = CK.myColor === 1 ? 'Red' : 'Black';
        ov.innerHTML = '<div class="chess-container" style="max-width:420px">' +
            '<div class="chess-header"><h2>Checkers</h2><button class="chess-close" onclick="resignMatch()">X</button></div>' +
            '<div style="padding:16px">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:12px">' +
            '<div style="font-size:12px;color:#888">You: ' + myLabel + '</div>' +
            '<div id="ckturn" style="font-size:12px;font-weight:700;color:#49e8c2">Waiting...</div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
            '<span id="cktimer1" style="font-family:monospace;color:#dc2626;font-weight:700">' + fmtTime(CK.timeLeft[0]) + '</span>' +
            '<span id="cktimer2" style="font-family:monospace;color:#888;font-weight:700">' + fmtTime(CK.timeLeft[1]) + '</span>' +
            '</div>' +
            '<div id="ckboard" style="border-radius:8px;overflow:hidden;margin-bottom:16px;display:inline-block"></div>' +
            '<div style="text-align:center"><button class="chess-btn chess-btn-danger" onclick="resignMatch()" style="font-size:12px;padding:8px 20px">Resign</button></div>' +
            '</div></div>';
        document.body.appendChild(ov);
        renderCkBoard();
    }
})();

console.log('[HTP Skill Games] Module loaded - createMatchWithLobby, Firebase relay, Connect4, Checkers');
