// =============================================================================
// htp-events-v3.js — Prediction Market Listing & Display
// Listens to Firebase /markets, renders event cards, handles position taking
// =============================================================================
(function() {
  'use strict';

  var marketsRef = null;
  var marketsListener = null;
  var expandedMarket = null;

  function truncateAddr(addr) {
    if (!addr || addr.length < 16) return addr || '--';
    return addr.substring(0, 10) + '...' + addr.substring(addr.length - 6);
  }

  function formatDate(ts) {
    if (!ts) return '--';
    var d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function timeUntil(ts) {
    if (!ts) return '--';
    var target = typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts;
    var diff = target - Date.now();
    if (diff <= 0) return 'Expired';
    var days = Math.floor(diff / 86400000);
    var hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return days + 'd ' + hours + 'h';
    var mins = Math.floor((diff % 3600000) / 60000);
    return hours + 'h ' + mins + 'm';
  }

  function renderMarketCard(market) {
    var id = market.marketId || market.id || '';
    var totalPool = (market.totalPool || 0);
    var outcomeCount = market.outcomes ? market.outcomes.length : 0;
    var isExpanded = expandedMarket === id;
    var hasMaximizer = market.maximizerLimitPct && market.maximizerLimitPct > 0;
    var showCovenantId = market.covenantId ? true : false;

    var html = 'u003cdiv class="market-card' + (isExpanded ? ' expanded' : '') + '" data-market-id="' + id + '"' + (hasMaximizer ? ' data-maximizer="true"' : '') + 'u003e';
    html += 'u003cdiv class="market-card-header" onclick="window.htpToggleMarket(\'' + id + '\')"u003e';
    html += 'u003cdiv class="market-card-title"u003e' + (market.title || 'Untitled');
    if (hasMaximizer) {
      html += ' u003cspan class="htp-maximizer-badge"u003eMaximizer ⚡u003c/spanu003e';
    }
    html += 'u003c/divu003e';
    html += 'u003cdiv class="market-card-meta"u003e';
    html += 'u003cspan class="market-meta-item"u003eBy ' + truncateAddr(market.creatorAddress) + 'u003c/spanu003e';
    html += 'u003cspan class="market-meta-item"u003e' + totalPool.toFixed(2) + ' KAS poolu003c/spanu003e';
    html += 'u003cspan class="market-meta-item"u003e' + outcomeCount + ' outcomesu003c/spanu003e';
    if (market.maximizerLimitPct && market.maximizerLimitPct > 0) {
      html += 'u003cspan class="market-meta-item"u003e' + market.maximizerLimitPct + '% max capu003c/spanu003e';
    }
    if (market.expectedVolume && market.expectedVolume > 0) {
      html += 'u003cspan class="market-meta-item"u003e' + market.expectedVolume + ' exp. volu003c/spanu003e';
    }
    html += 'u003cspan class="market-meta-item"u003eResolves ' + timeUntil(market.resolutionDate) + 'u003c/spanu003e';
    html += 'u003c/divu003e';

    // Covenant ID display
    if (market.covenantId) {
      html += 'u003cdiv class="market-covenant"u003e';
      html += 'Covenant ID: ' + market.covenantId + 'u003cbr>u003csmall>Hedge UTXO covenant-locked address</small>';
      html += 'u003c/divu003e';
    }

    // Live progress bar for creator events (used/cap)
    if (market.maximizerLimitPct && market.maximizerLimitPct > 0 && market.expectedVolume > 0) {
      var maxCap = market.expectedVolume * (market.maximizerLimitPct/100);
      var used = market.totalMaximizerVolume || market.totalPool || 0;
      var progressPct = maxCap > 0 ? Math.min(100, (used / maxCap) * 100) : 0;
      html += 'u003cdiv class="htp-progress-bar-wrap" style="margin-top:10px;"u003e';
      html += 'u003cdiv class="htp-progress-bar-label"u003e';
      html += 'u003cspan>Maximizer Usage</span>';
      html += 'u003cspan>' + used.toFixed(0) + ' / ' + maxCap.toFixed(0) + ' KAS (' + progressPct.toFixed(1) + '%)u003c/span>';
      html += 'u003c/divu003e';
      html += 'u003cdiv class="htp-progress-bar-track"u003e';
      html += 'u003cdiv class="htp-progress-bar-fill" style="width:' + progressPct + '%"u003eu003c/divu003e';
      html += 'u003c/divu003e';
      html += 'u003c/divu003e';
    }

    html += 'u003c/divu003e';
    if (isExpanded) {
      html += renderExpandedMarket(market);
    }

    html += '</div>';
    return html;
  }

  function renderExpandedMarket(market) {
    var html = 'u003cdiv class="market-card-body"u003e';

    // Covenant ID in expanded view
    if (market.covenantId) {
      html += 'u003cdiv class="market-covenant-expanded" style="margin-bottom:15px;padding:10px;background:rgba(73,232,194,0.1);border-radius:8px;"u003e';
      html += 'u003cstrong style="color:#49e8c2;"u003eCovenant ID:u003c/strong> u003ccode>' + market.covenantId + 'u003c/code>';
      html += 'u003cbr>u003csmall>Hedge UTXO is covenant-locked at this address</small>';
      html += 'u003c/divu003e';
    }

    // Description
    if (market.description) {
      html += '<p class="market-description">' + market.description + '</p>';
    }

    // Source URL
    if (market.sourceUrl) {
      html += '<div class="market-source">Source: <a href="' + market.sourceUrl + '" target="_blank" rel="noopener">' + market.sourceUrl + '</a></div>';
    }

    // Resolution date
    html += '<div class="market-resolution">Resolution: ' + formatDate(market.resolutionDate) + '</div>';

    // Outcomes with odds
    html += '<div class="market-outcomes">';
    if (market.outcomes && market.outcomes.length > 0) {
      var totalPositions = 0;
      var positionCounts = [];
      market.outcomes.forEach(function(outcome, idx) {
        var count = 0;
        if (market.positions) {
          Object.keys(market.positions).forEach(function(key) {
            var pos = market.positions[key];
            if (pos && pos.outcomeIndex === idx) count += (pos.size || 0);
          });
        }
        positionCounts.push(count);
        totalPositions += count;
      });

      market.outcomes.forEach(function(outcome, idx) {
        var odds = totalPositions > 0
          ? ((positionCounts[idx] / totalPositions) * 100).toFixed(1)
          : (100 / market.outcomes.length).toFixed(1);
        html += '<div class="market-outcome-row">';
        html += '<div class="outcome-info">';
        html += '<span class="outcome-name">' + outcome + '</span>';
        html += '<span class="outcome-odds">' + odds + '%</span>';
        html += '</div>';
        html += '<div class="outcome-bar"><div class="outcome-bar-fill" style="width:' + odds + '%"></div></div>';
        html += '<div class="outcome-action">';
        html += '<input type="number" class="input outcome-bet-input" placeholder="KAS" min="' + (market.minPosition || 1) + '" data-outcome-idx="' + idx + '" data-market-id="' + (market.marketId || '') + '">';
        html += '<button class="btn btn-primary btn-sm" onclick="window.htpPlaceBet(\'' + (market.marketId || '') + '\', ' + idx + ')">Bet</button>';
        html += '</div>';
        html += '</div>';
      });
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  function renderMarkets(markets) {
    var container = document.getElementById('active-markets');
    if (!container) return;

    if (!markets || markets.length === 0) {
      container.innerHTML = '<p class="text-muted">No active prediction markets yet.</p>';
      return;
    }

    // Sort by creation date descending
    markets.sort(function(a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    var html = '';
    markets.forEach(function(m) {
      html += renderMarketCard(m);
    });
    container.innerHTML = html;
  }

  function listenToMarkets() {
    if (marketsListener) return;

    var db = window.firebase && window.firebase.database ? window.firebase.database() : null;
    if (!db) {
      console.warn('[HTP Events v3] Firebase not available for market listing');
      return;
    }

    marketsRef = db.ref('markets');
    marketsListener = marketsRef.orderByChild('status').equalTo('active').on('value', function(snapshot) {
      var markets = [];
      if (snapshot.exists()) {
        snapshot.forEach(function(child) {
          var m = child.val();
          if (m) {
            m.marketId = m.marketId || child.key;
            markets.push(m);
          }
        });
      }
      renderMarkets(markets);
    }, function(err) {
      console.error('[HTP Events v3] Firebase listen error:', err);
    });
  }

  // Toggle expanded market card
  window.htpToggleMarket = function(marketId) {
    expandedMarket = expandedMarket === marketId ? null : marketId;
    // Re-render by triggering a fresh read
    if (marketsRef) {
      marketsRef.orderByChild('status').equalTo('active').once('value', function(snapshot) {
        var markets = [];
        if (snapshot.exists()) {
          snapshot.forEach(function(child) {
            var m = child.val();
            if (m) {
              m.marketId = m.marketId || child.key;
              markets.push(m);
            }
          });
        }
        renderMarkets(markets);
      });
    }
  };

  // Place a bet on a market outcome
  window.htpPlaceBet = function(marketId, outcomeIndex) {
    var addr = window.walletAddress || window.htpAddress || window.htpConnectedAddress;
    if (!addr) {
      if (window.openWalletModal) window.openWalletModal();
      else if (window.showToast) window.showToast('Connect wallet first', 'error');
      return;
    }

    var input = document.querySelector('input[data-market-id="' + marketId + '"][data-outcome-idx="' + outcomeIndex + '"]');
    var amount = input ? parseFloat(input.value) : 0;
    if (!amount || amount <= 0) {
      if (window.showToast) window.showToast('Enter a valid bet amount', 'error');
      return;
    }

    var db = window.firebase && window.firebase.database ? window.firebase.database() : null;
    if (!db) {
      if (window.showToast) window.showToast('Firebase not available', 'error');
      return;
    }

    var positionId = addr.substring(addr.length - 8) + '-' + Date.now().toString(36);
    var position = {
      address: addr,
      outcomeIndex: outcomeIndex,
      size: amount,
      timestamp: window.firebase.database.ServerValue.TIMESTAMP
    };

    if (window.showToast) window.showToast('Placing position...', 'info');

    var updates = {};
    updates['markets/' + marketId + '/positions/' + positionId] = position;

    db.ref().update(updates).then(function() {
      // Update total pool
      return db.ref('markets/' + marketId + '/totalPool').transaction(function(current) {
        return (current || 0) + amount;
      });
    }).then(function() {
      if (window.showToast) window.showToast('Position placed: ' + amount + ' KAS', 'success');
      if (input) input.value = '';
    }).catch(function(err) {
      console.error('[HTP Events v3] Bet error:', err);
      if (window.showToast) window.showToast('Failed: ' + err.message, 'error');
    });
  };

  // Listen for new market creation
  window.addEventListener('htp:market:created', function() {
    // Markets will auto-update via the Firebase listener
    console.log('[HTP Events v3] New market detected');
  });

  // Initialize — wait for Firebase to be ready
  function init() {
    // Guard: if Firebase app not yet initialized, wait for it
    if (!window.firebase || !window.firebase.apps || !window.firebase.apps.length) {
      window.addEventListener('htp:firebase:ready', function() {
        listenToMarkets();
        console.log('[HTP Events v3] Prediction market listing initialized (deferred)');
      });
      // Also try after a short delay in case the event already fired
      setTimeout(function() {
        if (window.firebase && window.firebase.apps && window.firebase.apps.length) {
          listenToMarkets();
        }
      }, 3000);
      return;
    }
    listenToMarkets();
    console.log('[HTP Events v3] Prediction market listing initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
