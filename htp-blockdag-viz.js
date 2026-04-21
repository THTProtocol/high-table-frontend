/**
 * htp-blockdag-viz.js - Live Kaspa BlockDAG Visualization (Canvas-based)
 *
 * Renders real block data from TN12 on HTML Canvas elements.
 * Polls blockdag stats every 5s, block data every 3s.
 */
(function(window) {
  'use strict';

  var STATS_INTERVAL = 5000;
  var BLOCKS_INTERVAL = 3000;
  var STATS_URL = 'https://api-tn12.kaspa.org/info/blockdag';
  // blocks endpoint requires lowHash; we fetch tip first, then use it
  var BLOCKS_BASE = 'https://api-tn12.kaspa.org/blocks';

  var BLOCK_W = 18;
  var BLOCK_H = 12;
  var BLOCK_R = 3;
  var PRIMARY = '#49e8c2';
  var PRIMARY_GLOW = 'rgba(73,232,194,0.6)';
  var BLOCK_FILL = '#0a1a14';
  var BG = '#010806';
  var LINE_COLOR = 'rgba(73,232,194,0.25)';
  var LABEL_COLOR = 'rgba(73,232,194,0.45)';

  // ── KASPA BLOCKDAG BACKGROUND ─────────────────────────────────────────
  // Three-layer deep-space DAG:
  //   Layer 1 — Starfield  : tiny pale dots moving at 20% of DAG speed (parallax)
  //   Layer 2 — DAG network: organic circles + bezier edges, slow scroll
  //   Layer 3 — Real blocks: brighter nodes from live TN12 API with real edges
  // Edge fade done per-node with smoothstep() — no CSS mask needed, zero hard lines.
  var _bgScrollX  = 0;
  var _bgNodes    = [];   // { id, absX, y, alpha, isChain, isReal, parentIds[] }
  var _bgNodeById = {};
  var _bgNextId   = 0;
  var _bgSpawnNext = 0;
  var _bgStars    = [];   // parallax starfield
  var _bgStarsOk  = false;
  var _BG_R        = 5.2; // base node radius
  var _SCROLL_SPEED = 0.85; // DAG scroll speed
  var _STAR_SPEED   = 0.17;  // stars scroll at 20% of DAG (parallax depth)
  var _SPAWN_GAP    = 48;    // px between clusters → denser DAG everywhere
  var _bgTime = 0;
  var _bgH = 600;
  var _bgW = 1400;
  var _bgRealByHash = {};

  function _bgRand(a, b) { return a + Math.random() * (b - a); }

  // Cubic smoothstep — produces a perfectly seamless S-curve fade, no hard line
  function _bgSmooth(x, lo, hi) {
    var t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
  }
  // Edge fade: 5% hair-thin zone at each edge — eliminates visible density gradient
  function _bgFade(bx, w) {
    var z = w * 0.05;
    return _bgSmooth(bx, 0, z) * _bgSmooth(w - bx, 0, z);
  }

  function _bgInitStars(w, h) {
    _bgStars = [];
    for (var i = 0; i < 140; i++) {
      _bgStars.push({
        absX: _bgRand(0, w * 1.6),
        y:    _bgRand(0, h),
        r:    Math.random() < 0.72 ? 0.6 : 1.2,
        a:    _bgRand(0.06, 0.22)
      });
    }
  }

  function _bgSpawnCluster(absX) {
    var count = Math.random() > 0.35 ? (Math.random() > 0.68 ? 3 : 2) : 1;
    var h = _bgH;
    var usedY = [];
    for (var n = 0; n < count; n++) {
      var y, tries = 0;
      do {
        y = _bgRand(h * 0.06, h * 0.94);
        tries++;
      } while (usedY.some(function(uy) { return Math.abs(uy - y) < h * 0.12; }) && tries < 20);
      usedY.push(y);

      var node = {
        id: _bgNextId++,
        absX: absX + _bgRand(-10, 10),
        y: y,
        alpha: _bgRand(0.32, 0.62),
        isChain: Math.random() > 0.55,
        isReal: false,
        parentIds: []
      };

      var searchMin = absX - _SPAWN_GAP * 3.5;
      var cands = _bgNodes.filter(function(b) {
        return b.absX < absX - 8 && b.absX > searchMin;
      }).sort(function(a, b) {
        return Math.abs(a.y - y) - Math.abs(b.y - y);
      });
      var nP = Math.min(1 + (Math.random() > 0.48 ? 1 : 0), cands.length);
      for (var p = 0; p < nP; p++) node.parentIds.push(cands[p].id);

      _bgNodes.push(node);
      _bgNodeById[node.id] = node;
    }
  }

  function initLaneDAG(w, h) {
    _bgScrollX = 0;
    _bgNodes   = [];
    _bgNodeById = {};
    _bgRealByHash = {};
    _bgNextId  = 0;
    _bgH = h;
    _bgW = w;
    if (!_bgStarsOk) { _bgInitStars(w, h); _bgStarsOk = true; }
    // Spawn from off-screen left so the canvas is fully populated at load time
    var x = -_SPAWN_GAP * 3;
    while (x < w + _SPAWN_GAP * 7) {
      _bgSpawnCluster(x);
      x += _SPAWN_GAP * _bgRand(0.65, 1.38);
    }
    _bgSpawnNext = x;
  }

  // Inject real API blocks into background visualization as prominent teal nodes
  function _injectRealBlocks(blocks) {
    if (!blocks || !blocks.length) return;
    var h = _bgH;
    var newBlocks = blocks.filter(function(b) { return b.hash && !_bgRealByHash[b.hash]; });
    if (!newBlocks.length) return;

    // Sort by blueScore ascending (oldest → newest)
    newBlocks.sort(function(a, b) { return (a.blueScore||0) - (b.blueScore||0); });

    var minScore = newBlocks[0].blueScore || 0;
    var maxScore = newBlocks[newBlocks.length - 1].blueScore || minScore;
    var scoreRange = maxScore - minScore || 1;
    // Map score range to a pixel span that ends at _bgSpawnNext
    var span = Math.min(scoreRange * 3, window.innerWidth * 0.8);
    // purge stale real-node tracking for old hash refs
    Object.keys(_bgRealByHash).forEach(function(hash) {
      var node = _bgRealByHash[hash];
      if (!node || node.absX < _bgScrollX - _SPAWN_GAP * 12) { delete _bgRealByHash[hash]; }
    });

    newBlocks.forEach(function(b) {
      var scoreFrac = (b.blueScore - minScore) / scoreRange;
      var absX = _bgSpawnNext - span + scoreFrac * span;
      // Y from hash bits — stable and organic
      var hashBits = parseInt(b.hash.substring(0, 6), 16) || 0;
      var y = h * 0.08 + (hashBits % 1000) / 1000 * h * 0.84;

      var node = {
        id: _bgNextId++,
        absX: absX,
        y: y,
        alpha: 0.62,
        isChain: true,
        isReal: true,
        hash: b.hash,
        realParents: b.parents || [],
        parentIds: []
      };
      _bgNodes.push(node);
      _bgNodeById[node.id] = node;
      _bgRealByHash[b.hash] = node;
    });

    // Wire real parent edges using actual parent hashes
    _bgNodes.filter(function(n) { return n.isReal && n.realParents && n.realParents.length; }).forEach(function(n) {
      n.realParents.forEach(function(ph) {
        var pNode = _bgRealByHash[ph];
        if (pNode && n.parentIds.indexOf(pNode.id) === -1) {
          n.parentIds.push(pNode.id);
          // also remove any synthetic parentIds that conflict
        }
      });
    });

    // Advance spawn cursor past the new real blocks
    _bgSpawnNext = Math.max(_bgSpawnNext, _bgSpawnNext + _SPAWN_GAP);
  }

  // Write live Kaspa data to Firebase Realtime DB
  function _syncFirebase(stats, blocks) {
    try {
      var fb = window.firebase;
      if (!fb || !fb.apps || !fb.apps.length) return;
      var db = fb.database();
      if (stats) {
        db.ref('kaspa/stats').set({
          blockCount:  stats.blockCount  || 0,
          daaScore:    stats.virtualDaaScore || 0,
          difficulty:  stats.difficulty  || 0,
          bps:         10,
          ts:          Date.now()
        });
      }
      if (blocks && blocks.length) {
        var recent = blocks.slice(-15).map(function(b) {
          return { hash: b.hash, blueScore: b.blueScore || 0, parents: (b.parents||[]).slice(0,3), ts: b.timestamp || 0 };
        });
        db.ref('kaspa/latestBlocks').set(recent);
        db.ref('kaspa/latestHash').set(blocks[blocks.length - 1].hash);
      }
    } catch(e) { /* firebase not ready yet */ }
  }

  function drawBackgroundMode(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    _bgTime += 0.016;
    _bgScrollX += _SCROLL_SPEED;
    _bgH = h;
    _bgW = w;

    // Spawn ahead
    while (_bgSpawnNext - _bgScrollX < w + _SPAWN_GAP * 7) {
      _bgSpawnCluster(_bgSpawnNext);
      _bgSpawnNext += _SPAWN_GAP * _bgRand(0.65, 1.38);
    }

    // Prune off-screen left
    var cutoff = _bgScrollX - _SPAWN_GAP * 9;
    _bgNodes = _bgNodes.filter(function(b) {
      if (b.absX < cutoff) {
        delete _bgNodeById[b.id];
        if (b.isReal && b.hash) delete _bgRealByHash[b.hash];
        return false;
      }
      return true;
    });

    ctx.save();
    ctx.lineCap = 'round';

    // ── Layer 1: Parallax starfield ──────────────────────────────
    // Stars scroll at 20% of DAG speed → creates depth illusion
    var starScroll = _bgScrollX * 0.20;
    var starWrap = w * 1.6;
    _bgStars.forEach(function(s) {
      var sx = ((s.absX - starScroll) % starWrap + starWrap) % starWrap;
      if (sx > w) return;
      var ef = _bgFade(sx, w);
      if (ef < 0.005) return;
      ctx.globalAlpha = s.a * ef;
      ctx.fillStyle = 'rgba(210,255,240,1)';
      ctx.beginPath();
      ctx.arc(sx, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Layer 2: DAG edges ───────────────────────────────────────
    _bgNodes.forEach(function(b) {
      var bx = b.absX - _bgScrollX;
      var bef = _bgFade(bx, w);
      if (bef < 0.005) return;

      b.parentIds.forEach(function(pid) {
        var p = _bgNodeById[pid];
        if (!p) return;
        var px = p.absX - _bgScrollX;
        var pef = _bgFade(px, w);
        var ef = Math.min(bef, pef);
        if (ef < 0.005) return;

        var isHot = (b.isChain || b.isReal) && (p.isChain || p.isReal);
        var dx = bx - px;
        var cp = dx * 0.42;
        ctx.globalAlpha = ef * (isHot ? 0.38 : 0.16);
        ctx.strokeStyle = '#49e8c2';
        ctx.lineWidth = isHot ? 1.1 : 0.65;
        ctx.beginPath();
        ctx.moveTo(px, b.y > p.y ? p.y : p.y);
        ctx.moveTo(px, p.y);
        ctx.bezierCurveTo(px + cp, p.y, bx - cp, b.y, bx, b.y);
        ctx.stroke();
      });
    });

    // ── Layer 3: Nodes ───────────────────────────────────────────
    _bgNodes.forEach(function(b) {
      var bx = b.absX - _bgScrollX;
      if (bx < -12 || bx > w + 12) return;
      var ef = _bgFade(bx, w);
      if (ef < 0.005) return;

      var a = b.alpha * ef;
      var isLatest = b.isReal && b.hash === _latestHash;

      if (b.isReal) {
        // ── Real API block: larger, fully opaque teal dot ────────
        var rr = isLatest ? _BG_R + 2.8 : _BG_R + 1.2;

        // Outer glow halo for latest
        if (isLatest) {
          var pulse = 0.12 + 0.08 * Math.sin(_bgTime * 1.7);
          ctx.globalAlpha = pulse * ef;
          ctx.fillStyle = 'rgba(73,232,194,0.35)';
          ctx.beginPath();
          ctx.arc(bx, b.y, rr + 8, 0, Math.PI * 2);
          ctx.fill();
        }

        // Filled dot
        ctx.globalAlpha = a * 0.92;
        ctx.fillStyle = isLatest ? '#49e8c2' : 'rgba(73,232,194,0.82)';
        ctx.beginPath();
        ctx.arc(bx, b.y, rr, 0, Math.PI * 2);
        ctx.fill();

        // Ring
        ctx.globalAlpha = a * 0.48;
        ctx.strokeStyle = '#49e8c2';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bx, b.y, rr + 2.8, 0, Math.PI * 2);
        ctx.stroke();

        // Hash label on latest real block
        if (isLatest) {
          ctx.globalAlpha = ef * 0.50;
          ctx.fillStyle = '#49e8c2';
          ctx.font = '7px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(b.hash.substring(0, 6) + '..' + b.hash.slice(-4), bx, b.y - rr - 4);
        }

      } else {
        // ── Synthetic ambient node ───────────────────────────────
        var r = b.isChain ? _BG_R + 0.8 : _BG_R;

        // Draw filled node with rounded rect instead of circle for kgi-like look
        ctx.globalAlpha = a * (b.isChain ? 0.72 : 0.38);
        ctx.fillStyle = 'rgba(73,232,194,0.18)';
        var ns = r * 2;
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(bx - r, b.y - r, ns, ns, 2); }
        else { ctx.arc(bx, b.y, r, 0, Math.PI * 2); }
        ctx.fill();

        ctx.globalAlpha = a * (b.isChain ? 0.85 : 0.50);
        ctx.strokeStyle = '#49e8c2';
        ctx.lineWidth = b.isChain ? 1.1 : 0.75;
        ctx.stroke();
      }
    });

    ctx.restore();
  }

  var _blocks = [];
  var _blockMap = {};
  var _latestHash = null;
  var _statsTimer = null;
  var _blocksTimer = null;
  var _animFrames = [];
  var _tooltip = null;
  var _connected = false;

  // ── Stats Polling ──────────────────────────────────────────────────────

  function fetchStats() {
    fetch(STATS_URL).then(function(r) { return r.json(); }).then(function(data) {
      _connected = true;
      var el;
      el = document.getElementById('statBlockHeight') || document.getElementById('kaspaBlockHeight') || document.getElementById('ks-block-height');
      if (el) el.textContent = (data.blockCount || 0).toLocaleString();

      el = document.getElementById('statDaaScore') || document.getElementById('kaspaDaaScore') || document.getElementById('ks-daa-score');
      if (el) el.textContent = (data.virtualDaaScore || 0).toLocaleString();

      el = document.getElementById('statHashrate') || document.getElementById('kaspaHashrate') || document.getElementById('ks-hashrate');
      if (el) {
        var h = computeHashrate(data.difficulty || 0);
        el.textContent = h;
      }

      el = document.getElementById('statBlockRate') || document.getElementById('kaspaBlockRate') || document.getElementById('ks-block-rate');
      if (el) el.textContent = '10 bps';

      el = document.getElementById('statFee') || document.getElementById('kaspaFee') || document.getElementById('ks-fee');
      if (el) el.textContent = '~0.0001 KAS';
      _syncFirebase(data, null);
    }).catch(function() {
      _connected = false;
    });
  }

  function computeHashrate(difficulty) {
    if (!difficulty) return '--';
    var hr = difficulty * Math.pow(2, 32) / 1;
    if (hr >= 1e18) return (hr / 1e18).toFixed(2) + ' EH/s';
    if (hr >= 1e15) return (hr / 1e15).toFixed(2) + ' PH/s';
    if (hr >= 1e12) return (hr / 1e12).toFixed(2) + ' TH/s';
    if (hr >= 1e9) return (hr / 1e9).toFixed(2) + ' GH/s';
    if (hr >= 1e6) return (hr / 1e6).toFixed(2) + ' MH/s';
    return hr.toFixed(0) + ' H/s';
  }

  // ── Block Polling ──────────────────────────────────────────────────────

  function fetchBlocks() {
    // Step 1: get tip hash from blockdag info
    fetch(STATS_URL).then(function(r) { return r.json(); }).then(function(info) {
      var tipHash = info && info.tipHashes && info.tipHashes[0];
      if (!tipHash && info && info.sink) tipHash = info.sink;
      if (!tipHash) return;
      // Step 2: use tip as lowHash to get blocks
      var url = BLOCKS_BASE + '?lowHash=' + tipHash + '&includeBlocks=true&limit=40';
      return fetch(url).then(function(r) { return r.json(); });
    }).then(function(data) {
      if (!data || !data.blocks || !Array.isArray(data.blocks)) return;
      _connected = true;
      var incoming = data.blocks.map(function(b) {
        var hdr = b.header || {};
        return {
          hash: hdr.hash || '',
          parents: (hdr.parentsByLevel && hdr.parentsByLevel[0]) ? hdr.parentsByLevel[0] : [],
          blueScore: hdr.blueScore || 0,
          timestamp: parseInt(hdr.timestamp, 10) || 0,
          slideIn: 0
        };
      }).filter(function(b) { return b.hash; });

      // Sort by timestamp ascending (oldest first)
      incoming.sort(function(a, b) { return a.timestamp - b.timestamp; });

      // Mark new blocks for slide-in animation
      var oldMap = _blockMap;
      _blockMap = {};
      incoming.forEach(function(b) {
        if (!oldMap[b.hash]) {
          b.slideIn = 1; // animate from right
        } else {
          b.slideIn = 0;
        }
        _blockMap[b.hash] = b;
      });

      _blocks = incoming;
      if (_blocks.length > 0) {
        _latestHash = _blocks[_blocks.length - 1].hash;
      }
      _injectRealBlocks(_blocks);
      _syncFirebase(null, _blocks);
    }).catch(function() {
      _connected = false;
    });
  }

  // ── Canvas Rendering ───────────────────────────────────────────────────

  function drawDAG(ctx, w, h, isBackground) {
    if (isBackground) {
      // Full-page background: transparent, animated particles + live blocks
      drawBackgroundMode(ctx, w, h);
      return;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    if (!_blocks.length) {
      drawConnecting(ctx, w, h);
      return;
    }

    // Label
    ctx.save();
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('LIVE KASPA BLOCKDAG', 10, 8);
    ctx.restore();

    var padding = 30;
    var usableW = w - padding * 2;
    var usableH = h - padding * 2;
    var n = _blocks.length;
    var spacingX = n > 1 ? usableW / (n - 1) : 0;
    var centerY = padding + usableH / 2;

    // Build position lookup for parent lines
    var posMap = {};
    _blocks.forEach(function(b, i) {
      var slideOffset = b.slideIn * 40;
      b.slideIn = Math.max(0, b.slideIn - 0.08);
      var bx = padding + i * spacingX + slideOffset;
      // Stagger Y slightly based on hash to show DAG structure
      var yOff = ((parseInt(b.hash.substring(0, 4), 16) || 0) % 5 - 2) * (BLOCK_H * 0.8);
      var by = centerY + yOff - BLOCK_H / 2;
      posMap[b.hash] = { x: bx, y: by };
    });

    // Draw parent lines
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1;
    _blocks.forEach(function(b) {
      var pos = posMap[b.hash];
      if (!pos) return;
      b.parents.forEach(function(ph) {
        var ppos = posMap[ph];
        if (!ppos) return;
        ctx.beginPath();
        ctx.moveTo(ppos.x + BLOCK_W, ppos.y + BLOCK_H / 2);
        ctx.lineTo(pos.x, pos.y + BLOCK_H / 2);
        ctx.stroke();
      });
    });

    // Draw blocks
    _blocks.forEach(function(b) {
      var pos = posMap[b.hash];
      if (!pos) return;
      var isLatest = b.hash === _latestHash;

      // Glow for latest
      if (isLatest) {
        var pulse = 4 + 2 * Math.sin(Date.now() / 300);
        ctx.save();
        ctx.shadowColor = PRIMARY_GLOW;
        ctx.shadowBlur = pulse;
        ctx.fillStyle = PRIMARY_GLOW;
        roundRect(ctx, pos.x - 2, pos.y - 2, BLOCK_W + 4, BLOCK_H + 4, BLOCK_R + 1);
        ctx.fill();
        ctx.restore();
      }

      // Block rect
      ctx.fillStyle = isLatest ? PRIMARY_GLOW : BLOCK_FILL;
      ctx.strokeStyle = PRIMARY;
      ctx.lineWidth = isLatest ? 2 : 1;
      roundRect(ctx, pos.x, pos.y, BLOCK_W, BLOCK_H, BLOCK_R);
      ctx.fill();
      ctx.stroke();

      // Hash label on latest
      if (isLatest) {
        ctx.save();
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '8px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        var label = b.hash.substring(0, 6) + '...' + b.hash.slice(-4);
        ctx.fillText(label, pos.x + BLOCK_W / 2, pos.y + BLOCK_H + 4);
        ctx.restore();
      }
    });
  }

  function drawConnecting(ctx, w, h) {
    var t = Date.now() / 1000;
    ctx.save();
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shimmer effect
    var shimmer = 0.4 + 0.3 * Math.sin(t * 2);
    ctx.fillStyle = 'rgba(226,232,240,' + shimmer.toFixed(2) + ')';
    ctx.fillText('Connecting to Kaspa network...', w / 2, h / 2);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  // ── Tooltip ────────────────────────────────────────────────────────────

  function setupTooltip(canvas) {
    canvas.addEventListener('click', function(e) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var mx = (e.clientX - rect.left) * scaleX;
      var my = (e.clientY - rect.top) * scaleY;

      var padding = 30;
      var usableW = canvas.width - padding * 2;
      var n = _blocks.length;
      var spacingX = n > 1 ? usableW / (n - 1) : 0;
      var centerY = padding + (canvas.height - padding * 2) / 2;

      var hit = null;
      _blocks.forEach(function(b, i) {
        var bx = padding + i * spacingX;
        var yOff = ((parseInt(b.hash.substring(0, 4), 16) || 0) % 5 - 2) * (BLOCK_H * 0.8);
        var by = centerY + yOff - BLOCK_H / 2;
        if (mx >= bx && mx <= bx + BLOCK_W && my >= by && my <= by + BLOCK_H) {
          hit = b;
        }
      });

      removeTooltip();
      if (hit) {
        showTooltip(e.clientX, e.clientY, hit);
      }
    });
  }

  function showTooltip(px, py, block) {
    removeTooltip();
    _tooltip = document.createElement('div');
    _tooltip.style.cssText = 'position:fixed;z-index:1000;background:#1a2235;border:1px solid rgba(79,152,163,0.4);color:#e2e8f0;padding:10px 14px;border-radius:8px;font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.6;pointer-events:none;max-width:320px;';
    _tooltip.style.left = px + 12 + 'px';
    _tooltip.style.top = py + 12 + 'px';
    var ts = block.timestamp ? new Date(block.timestamp * 1000).toLocaleString() : '--';
    _tooltip.innerHTML =
      '<div style="color:#4f98a3;font-weight:600;margin-bottom:4px;">Block</div>' +
      '<div>Hash: ' + block.hash.substring(0, 12) + '...' + block.hash.slice(-6) + '</div>' +
      '<div>Timestamp: ' + ts + '</div>' +
      '<div>Parents: ' + block.parents.length + '</div>' +
      '<div>Blue Score: ' + (block.blueScore || '--') + '</div>';
    document.body.appendChild(_tooltip);
  }

  function removeTooltip() {
    if (_tooltip) {
      _tooltip.remove();
      _tooltip = null;
    }
  }

  // ── Animation Loop ─────────────────────────────────────────────────────

  function startLoop(canvas, isBackground) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Init lane-based DAG once for background mode
    if (isBackground) {
      var r = canvas.getBoundingClientRect();
      initLaneDAG(r.width || window.innerWidth, r.height || window.innerHeight);
    }

    function tick() {
      var dpr = window.devicePixelRatio || 1;
      var rect = canvas.getBoundingClientRect();
      var needsRescale = canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr;
      if (needsRescale) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        if (isBackground) initLaneDAG(rect.width, rect.height);
      }
      drawDAG(ctx, rect.width, rect.height, isBackground);
      var id = requestAnimationFrame(tick);
      canvas._animId = id;
    }

    tick();
    _animFrames.push(canvas);
  }

  function stopLoop(canvas) {
    if (canvas && canvas._animId) {
      cancelAnimationFrame(canvas._animId);
      canvas._animId = null;
    }
  }

  // ── Resize Handler ─────────────────────────────────────────────────────

  function handleResize() {
    _animFrames.forEach(function(canvas) {
      if (!canvas || !canvas.parentElement) return;
      var container = canvas.parentElement;
      canvas.style.width = container.clientWidth + 'px';
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────

  function init() {
    // dagCanvas background is fully managed by inline script in index.html
    // This module only handles stats/block polling and optional panel canvases

    // Panel canvases — solid dark background with DAG detail
    var mainCanvas = document.getElementById('dagCanvasFull') || document.getElementById('blockdag-canvas');
    var miniCanvas = document.getElementById('dagCanvasMini') || document.getElementById('overview-dag-canvas');

    if (mainCanvas) {
      mainCanvas.style.width = '100%';
      mainCanvas.style.display = 'block';
      startLoop(mainCanvas, false);
      setupTooltip(mainCanvas);
    }

    if (miniCanvas) {
      miniCanvas.style.width = '100%';
      miniCanvas.style.display = 'block';
      startLoop(miniCanvas, false);
      setupTooltip(miniCanvas);
    }

    // Start polling
    fetchStats();
    fetchBlocks();
    _statsTimer = setInterval(fetchStats, STATS_INTERVAL);
    _blocksTimer = setInterval(fetchBlocks, BLOCKS_INTERVAL);

    window.addEventListener('resize', handleResize);

    // Close tooltip on scroll/click elsewhere
    document.addEventListener('scroll', removeTooltip, true);

    console.log('[BlockDAG] Initialized');
  }

  // ── Public API ─────────────────────────────────────────────────────────

  window.htpBlockDAG = {
    init: init,
    startPolling: function() {
      if (!_statsTimer) _statsTimer = setInterval(fetchStats, STATS_INTERVAL);
      if (!_blocksTimer) _blocksTimer = setInterval(fetchBlocks, BLOCKS_INTERVAL);
    },
    stopPolling: function() {
      clearInterval(_statsTimer); _statsTimer = null;
      clearInterval(_blocksTimer); _blocksTimer = null;
      _animFrames.forEach(stopLoop);
      _animFrames = [];
    },
    getLatestBlockHash: function() { return _latestHash; },
    getBlockCount: function() { return _blocks.length; },
    isConnected: function() { return _connected; }
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[BlockDAG] Module loaded');

})(window);
