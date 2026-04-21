// firebase-config.js — HTP hightable420
(function () {
  'use strict';

  var firebaseConfig = {
    apiKey:            "AIzaSyA9n5AMFgmCL861rmqE_6ajBBEC5BboPd8",
    authDomain:        "hightable420.firebaseapp.com",
    databaseURL:       "https://hightable420-default-rtdb.europe-west1.firebasedatabase.app",
    projectId:         "hightable420",
    storageBucket:     "hightable420.firebasestorage.app",
    messagingSenderId: "863234270639",
    appId:             "1:863234270639:web:417286ea3466df1094ab94",
    measurementId:     "G-V3JVLM0T0M"
  };

  function loadScript(src, cb) {
    if (document.querySelector('script[src="' + src + '"]')) { cb && cb(); return; }
    var s = document.createElement('script');
    s.src = src; s.onload = cb;
    document.head.appendChild(s);
  }

  function initFirebase() {
    if (typeof firebase === 'undefined') { setTimeout(initFirebase, 200); return; }
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    var db = firebase.database();
    console.log('%cHTP Firebase ready — hightable420', 'color:#49e8c2;font-weight:bold');
    window.dispatchEvent(new CustomEvent('htp:firebase:ready'));

    window.htpFirebase = {

      createMatch: function(matchId, playerId, walletAddr, matchObj) {
        return db.ref('matches/' + matchId).set({
          info: {
            game:          matchObj.game || 'chess',
            timeControl:   matchObj.timeControl || 300,
            stake:         matchObj.stake || 5,
            seriesLen:     matchObj.seriesLen || 1,
            status:        'waiting',
            created:       Date.now(),
            escrowAddress: matchObj.escrowAddress || null
          },
          players: {
            creator:         playerId,
            creatorAddr:     walletAddr ? walletAddr.substring(0,20)+'...' : '',
            creatorAddrFull: walletAddr || ''
          }
        });
      },

      joinMatch: function(matchId, playerId, walletAddr, walletAddrFull, joinTxId) {
        return db.ref('matches/' + matchId).update({
          'info/status':              'active',
          'info/joinTxId':            joinTxId || null,
          'players/opponent':         playerId,
          'players/opponentAddr':     walletAddr ? walletAddr.substring(0,20)+'...' : '',
          'players/opponentAddrFull': walletAddrFull || walletAddr || ''
        });
      },

      cancelMatch: function(matchId) {
        return db.ref('matches/' + matchId).remove();
      },

      setMatchStatus: function(matchId, status) {
        return db.ref('matches/' + matchId + '/info/status').set(status);
      },

      getMatch: async function(matchId) {
        var snap = await db.ref('matches/' + matchId).once('value');
        var val  = snap.val();
        if (!val) return null;
        return {
          id:               matchId,
          game:             (val.info && val.info.game)             || 'chess',
          timeControl:      (val.info && val.info.timeControl)      || 300,
          stake:            (val.info && val.info.stake)            || 5,
          status:           (val.info && val.info.status)           || 'waiting',
          escrowAddress:    (val.info && val.info.escrowAddress)    || null,
          creator:          (val.players && val.players.creator)          || null,
          creatorAddrFull:  (val.players && val.players.creatorAddrFull)  || null,
          opponent:         (val.players && val.players.opponent)         || null,
          opponentAddrFull: (val.players && val.players.opponentAddrFull) || null
        };
      },

      createEvent: function(eventId, creatorAddr, eventObj) {
        return db.ref('events/' + eventId).set({
          id:        eventId,
          question:  eventObj.question  || '',
          category:  eventObj.category  || 'General',
          outcomes:  eventObj.outcomes  || ['Yes','No'],
          source:    eventObj.source    || '',
          closeDaa:  eventObj.closeDaa  || 0,
          closeTime: eventObj.closeTime || 0,
          oracle:    eventObj.oracle    || 'hybrid',
          bond:      eventObj.bond      || 1000,
          maximizer: eventObj.maximizer !== false,
          maxCap:    eventObj.maxCap    || 20,
          escrow:    eventObj.escrow    || null,
          creator:   creatorAddr        || '',
          status:    'open',
          created:   Date.now(),
          poolSpot:  {},
          poolMax:   {}
        });
      },

      updateEventStatus: function(eventId, status, extra) {
        return db.ref('events/' + eventId).update(Object.assign({ status: status }, extra || {}));
      },

      getEvent: async function(eventId) {
        var snap = await db.ref('events/' + eventId).once('value');
        return snap.val();
      },

      subscribeEvents: function(cb) {
        db.ref('events').on('value', function(snap) {
          var val = snap.val();
          if (!val) { cb([]); return; }
          cb(Object.values(val).filter(Boolean));
        });
      },

      writeAttestation: function(eventId, address, outcome, sig) {
        var safe = address.replace(/[.#$]/g, '_');
        return db.ref('attestations/' + eventId + '/' + safe).set({
          outcome: outcome, sig: sig, ts: Date.now()
        });
      },

      getAttestations: async function(eventId) {
        var snap = await db.ref('attestations/' + eventId).once('value');
        return snap.val() || {};
      },

      writeResolution: function(eventId, outcome, method, txId) {
        return db.ref('events/' + eventId).update({
          status:     'resolved',
          outcome:    outcome,
          resolution: { outcome: outcome, method: method || 'oracle', ts: Date.now(), final: true },
          settleTx:   txId || null
        });
      },

      
listenLobby: function(cb) {
  db.ref('matches').on('value', function(snap) {
    var val = snap.val();
    if (!val) { cb([]); return; }
    var now = Date.now();
    var matches = Object.keys(val).map(function(id) {
      var m = val[id];
      if (!m || !m.info) return null;
      if (now - (m.info.created || 0) > 3600000) return null;
      return {
        id: id,
        game: m.info.game || 'chess',
        timeControl: m.info.timeControl || 300,
        stake: m.info.stake || 5,
        status: m.info.status || 'waiting',
        created: m.info.created || now,
        escrowAddress: m.info.escrowAddress || null,
        creatorId: (m.players && m.players.creator) || 'unknown',
        creator: (m.players && m.players.creatorAddrFull) || '',
        opponent: (m.players && m.players.opponent) || null
      };
    }).filter(Boolean);
    cb(matches);
  });
},

writeWalletStat: function(address, matchId, record) {
        return db.ref('walletstats/' + address.replace(/[.#$]/g,'_') + '/' + matchId).set(record);
      },

      pushMove: function(matchId, moveMsg) {
        return db.ref('relay/' + matchId + '/moves').push(moveMsg);
      },

      listenMoves: function(matchId, cb) {
        var ref = db.ref('relay/' + matchId + '/moves');
        ref.on('child_added', function(snap) { if (snap.val()) cb(snap.val()); });
        return function() { ref.off('child_added'); };
      },

      setPresence: function(matchId, playerId, online) {
        return db.ref('relay/' + matchId + '/presence/' + playerId).set({
          online: online, ts: Date.now()
        });
      },

      syncClock: function(matchId, clock) {
        return db.ref('relay/' + matchId + '/clock').set(
          Object.assign({}, clock, { _st: firebase.database.ServerValue.TIMESTAMP })
        );
      },

      watchClock: function(matchId, cb) {
        db.ref('relay/' + matchId + '/clock').on('value', function(snap) {
          if (snap.val()) cb(snap.val());
        });
      },

      writeResult: function(matchId, result) {
        return db.ref('relay/' + matchId + '/result').set(result);
      },

      watchResult: function(matchId, cb) {
        db.ref('relay/' + matchId + '/result').on('value', function(snap) {
          if (snap.val()) cb(snap.val());
        });
      },

      challengeResult: function(matchId, challengerAddr, evidence) {
        return db.ref('relay/' + matchId + '/challenge').set({
          challenger: challengerAddr, evidence: evidence,
          ts: Date.now(), status: 'open'
        });
      },

      watchChallenge: function(matchId, cb) {
        db.ref('relay/' + matchId + '/challenge').on('value', function(snap) {
          if (snap.val()) cb(snap.val());
        });
      }

    };

    // Lobby sync — pushes Firebase matches to index via custom event
    db.ref('matches').on('value', function(snap) {
      var val = snap.val();
      if (!val) return;
      var now = Date.now();
      var matches = Object.keys(val).map(function(id) {
        var m = val[id];
        if (!m || !m.info) return null;
        if (now - (m.info.created || 0) > 3600000) return null;
        return {
          id:            id,
          game:          m.info.game          || 'chess',
          timeControl:   m.info.timeControl   || 300,
          stake:         m.info.stake         || 5,
          seriesLen:     m.info.seriesLen     || 1,
          status:        m.info.status        || 'waiting',
          created:       m.info.created       || now,
          escrowAddress: m.info.escrowAddress || null,
          creatorId:     (m.players && m.players.creator)         || 'unknown',
          creator:       (m.players && m.players.creatorAddrFull) || '',
          opponent:      (m.players && m.players.opponent)        || null,
          joinTxId:      m.info.joinTxId || null
        };
      }).filter(Boolean);
      window.dispatchEvent(new CustomEvent('htp-firebase-lobby', { detail: { matches: matches } }));
    });
  }

  loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js', function() {
    loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js', initFirebase);
  });

})();
