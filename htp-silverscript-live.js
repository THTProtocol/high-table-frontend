// =============================================================================
// htp-silverscript-live.js — Real-time SilverScript Compiler
// Watches prediction event form fields and generates syntax-highlighted preview
// =============================================================================
(function() {
  'use strict';

  var KEYWORDS = ['DEFINE', 'MARKET', 'ESCROW', 'SETTLEMENT', 'SEND', 'TO', 'FOR', 'EACH', 'IN', 'AND', 'OR', 'KAS'];
  var TREASURY = 'kaspatest:qpyfz03k...354m';
  var FEE_BPS = 200;

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function highlightLine(raw) {
    var escaped = escapeHtml(raw);

    // Comments
    if (/^\s*\/\//.test(escaped)) {
      return '<span class="ss-comment">' + escaped + '</span>';
    }

    // Highlight strings (quoted values)
    escaped = escaped.replace(/"([^"]*)"/g, '<span class="ss-string">"$1"</span>');

    // Highlight numbers (standalone digits, including decimals)
    escaped = escaped.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="ss-value">$1</span>');

    // Highlight keywords
    KEYWORDS.forEach(function(kw) {
      var re = new RegExp('\\b' + kw + '\\b', 'g');
      escaped = escaped.replace(re, '<span class="ss-keyword">' + kw + '</span>');
    });

    // Highlight punctuation
    escaped = escaped.replace(/([{}()\[\]:,])/g, '<span class="ss-punct">$1</span>');

    return escaped;
  }

  function getFormValues() {
    var titleEl = document.getElementById('event-title');
    var descEl = document.getElementById('event-description');
    var dateEl = document.getElementById('event-resolution-date');
    var urlEl = document.getElementById('event-source-url');
    var minPosEl = document.getElementById('event-min-position');

    var outcomes = [];
    document.querySelectorAll('.outcome-input').forEach(function(inp) {
      if (inp.value.trim()) outcomes.push(inp.value.trim());
    });

    return {
      title: titleEl ? titleEl.value.trim() : '',
      description: descEl ? descEl.value.trim() : '',
      date: dateEl ? dateEl.value : '',
      url: urlEl ? urlEl.value.trim() : '',
      minPosition: minPosEl ? (minPosEl.value || '1') : '1',
      outcomes: outcomes
    };
  }

  function getMissingFields(v) {
    var missing = [];
    if (!v.title) missing.push('Title');
    if (!v.date) missing.push('Resolution Date');
    if (!v.url) missing.push('Source URL');
    if (v.outcomes.length < 2) missing.push('At least 2 Outcomes');
    return missing;
  }

  function generateRawScript(v) {
    var ts = v.date ? Math.floor(new Date(v.date).getTime() / 1000) : 0;
    var outcomesArr = v.outcomes.length >= 2
      ? v.outcomes.map(function(o) { return '"' + o + '"'; }).join(', ')
      : '"...", "..."';

    var safeName = (v.title || 'Untitled').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').substring(0, 40) || 'MyEvent';

    var lines = [
      '// HTP Prediction Market Covenant',
      '// Generated: ' + new Date().toISOString(),
      '',
      'event ' + safeName + ' {',
      '  outcomes: [' + outcomesArr + '];',
      '  locktime: fromDate("' + (v.date ? v.date + 'T18:00:00Z' : '...') + '");',
      '  oracle: bondedOracle(100);',
      '  fee: 0.02;',
      '  bond: 1000;',
      '  source: "' + (v.url || '...') + '";',
      '  network: tn12;',
      '}',
    ];
    return lines;
  }

  function compile() {
    var output = document.getElementById('compiler-output');
    var dot = document.getElementById('compiler-dot');
    var statusText = document.getElementById('compiler-status-text');
    if (!output) return;

    var v = getFormValues();
    var missing = getMissingFields(v);
    var valid = missing.length === 0;

    // Update status indicator
    if (dot && statusText) {
      if (valid) {
        dot.className = 'dot dot-green';
        statusText.textContent = 'Valid';
        statusText.style.color = 'var(--success)';
      } else {
        dot.className = 'dot dot-grey';
        statusText.textContent = 'Incomplete — ' + missing.join(', ');
        statusText.style.color = 'var(--text-faint)';
      }
    }

    // Generate highlighted code with line numbers
    var lines = generateRawScript(v);
    var html = lines.map(function(line) {
      return '<span class="line">' + highlightLine(line) + '</span>';
    }).join('');

    output.innerHTML = html;
  }

  function copyToClipboard() {
    var v = getFormValues();
    var lines = generateRawScript(v);
    var raw = lines.join('\n');

    navigator.clipboard.writeText(raw).then(function() {
      var btn = document.querySelector('#compiler-panel .btn-secondary');
      if (btn) {
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = orig; }, 1500);
      }
    }).catch(function() {
      // Fallback
      var ta = document.createElement('textarea');
      ta.value = raw;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }

  function init() {
    // Bind to specific form fields
    var fields = [
      '#event-title',
      '#event-description',
      '#event-resolution-date',
      '#event-source-url',
      '#event-min-position'
    ];

    fields.forEach(function(sel) {
      var el = document.querySelector(sel);
      if (el) {
        el.addEventListener('input', compile);
        el.addEventListener('change', compile);
      }
    });

    // Delegate for dynamic outcome inputs
    var outcomesContainer = document.getElementById('outcomesContainer');
    if (outcomesContainer) {
      outcomesContainer.addEventListener('input', function(e) {
        if (e.target.classList.contains('outcome-input')) compile();
      });
    }

    // Also observe for added/removed outcome rows
    if (outcomesContainer && window.MutationObserver) {
      new MutationObserver(compile).observe(outcomesContainer, { childList: true });
    }

    // Initial compile
    compile();
    console.log('[HTP SilverScript] Live compiler initialized');
  }

  // Override global compileSilverScript with new implementation
  window.compileSilverScript = compile;
  window.copySilverScript = copyToClipboard;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
