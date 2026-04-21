// =============================================================================
// htp-event-creator.js — Prediction Market Event Creation
// Validates form, constructs escrow TX, writes to Firebase /markets/{marketId}
// =============================================================================
(function(W) {
  'use strict';

  function generateId() {
    return 'MKT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  function getConnectedAddress() {
    return W.walletAddress || W.htpAddress || W.htpConnectedAddress || null;
  }

  function isValidUrl(str) {
    try { var u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch (e) { return false; }
  }

  function validate() {
    var errors = [];
    var title = document.getElementById('event-title');
    var desc = document.getElementById('event-description');
    var date = document.getElementById('event-resolution-date');
    var url = document.getElementById('event-source-url');
    var minPos = document.getElementById('event-min-position');
    var expectedVol = document.getElementById('event-expected-volume');
    var maxPct = document.getElementById('event-maximizer-limit-pct');
    var oracleAddr = document.getElementById('event-oracle-address');

    if (!title || !title.value.trim()) errors.push('Event title is required');
    if (!desc || !desc.value.trim()) errors.push('Description is required');

    if (!date || !date.value) {
      errors.push('Resolution date is required');
    } else {
      var resDate = new Date(date.value);
      if (resDate <= new Date()) errors.push('Resolution date must be in the future');
    }

    if (!url || !url.value.trim()) {
      errors.push('Source URL is required');
    } else if (!isValidUrl(url.value.trim())) {
      errors.push('Source URL must be a valid URL');
    }

    // Validate outcomes
    var outcomes = [];
    document.querySelectorAll('.outcome-input').forEach(function(inp) {
      if (inp.value.trim()) outcomes.push(inp.value.trim());
    });
    if (outcomes.length < 2) errors.push('At least 2 outcomes are required');

    // Validate expected volume
    if (expectedVol && expectedVol.value) {
      var vol = parseFloat(expectedVol.value);
      if (isNaN(vol) || vol < 0) errors.push('Expected volume must be a positive number');
    }

    // Validate maximizer limit percentage
    if (maxPct && maxPct.value) {
      var pct = parseFloat(maxPct.value);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        errors.push('Maximizer limit percentage must be between 0 and 100');
      }
    }

    // Validate oracle address format (optional)
    if (oracleAddr && oracleAddr.value) {
      var addr = oracleAddr.value.trim();
      if (addr.length < 10 || addr.indexOf(':') === -1) {
        errors.push('Oracle address must be in format address:index');
      }
    }

    return { errors: errors, outcomes: outcomes };
  }

  function showErrors(errors) {
    if (W.showToast) {
      errors.forEach(function(e) { W.showToast(e, 'error'); });
    } else {
      alert(errors.join('\n'));
    }
  }

  W.createPredictionEvent = function() {
    // Pre-flight fee calculation based on expected inputs
    var expectedVol = parseFloat(document.getElementById('event-expected-volume').value) || 0;
    var maxPct = parseFloat(document.getElementById('event-maximizer-limit-pct').value) || 0;
    
    if (expectedVol > 0 && maxPct > 0) {
      const potentialFee = (expectedVol * 0.02) + (expectedVol * (maxPct/100) * 0.3);
      if (W.showToast) W.showToast('Estimated total fees: ' + potentialFee.toFixed(2) + ' KAS based on expected volume', 'info');
    }

    var addr = getConnectedAddress();
    if (!addr) {
      if (W.openWalletModal) W.openWalletModal();
      else if (W.showToast) W.showToast('Connect wallet first', 'error');
      return;
    }

    var result = validate();
    if (result.errors.length > 0) {
      showErrors(result.errors);
      return;
    }

    var title = document.getElementById('event-title').value.trim();
    var desc = document.getElementById('event-description').value.trim();
    var dateVal = document.getElementById('event-resolution-date').value;
    var url = document.getElementById('event-source-url').value.trim();
    var minPos = parseFloat(document.getElementById('event-min-position').value) || 1;
    var maxPEl = document.getElementById('event-max-participants');
    var maxP = maxPEl && maxPEl.value ? parseInt(maxPEl.value) : null;
    var expectedVolume = parseFloat(document.getElementById('event-expected-volume').value) || 0;
    var maxPct = parseFloat(document.getElementById('event-maximizer-limit-pct').value);
    var maxPctVal = Math.max(0, Math.min(100, (isNaN(maxPct) ? 0 : maxPct)));
    var oracleAddr = document.getElementById('event-oracle-address').value.trim() || null;
    var timestamp = Math.floor(new Date(dateVal).getTime() / 1000);
    var marketId = generateId();

    var market = {
      marketId: marketId,
      title: title,
      description: desc,
      outcomes: result.outcomes,
      resolutionDate: timestamp,
      sourceUrl: url,
      minPosition: minPos,
      maxParticipants: maxP,
      expectedVolume: expectedVolume,
      maximizerLimitPct: maxPctVal,
      oracleAddress: oracleAddr,
      creatorAddress: addr,
      status: 'active',
      totalPool: 0,
      positions: {},
      covenantId: null, // Will be set after creation
      createdAt: null // set by Firebase ServerValue
    };

    if (W.showToast) W.showToast('Creating prediction market...', 'info');

    // Write to Firebase
    var db = W.firebase && W.firebase.database ? W.firebase.database() : null;
    if (!db) {
      console.warn('[HTP EventCreator] Firebase not available');
      W.dispatchEvent(new CustomEvent('htp:market:created', { detail: market }));
      if (W.showToast) W.showToast('Market created locally (no Firebase)', 'warning');
      return;
    }

    market.createdAt = W.firebase.database.ServerValue.TIMESTAMP;

    db.ref('markets/' + marketId).set(market).then(function() {
      console.log('[HTP EventCreator] Market created:', marketId);
      if (W.showToast) W.showToast('Market created: ' + title, 'success');
      
      // Show covenant ID in UI
      const covenantId = 'cov_' + marketId.toLowerCase() + '_' + new Date().getTime().toString(36);
      if (W.showToast) W.showToast('Covenant ID: ' + covenantId, 'info');
      
      // Update market with covenant ID
      market.covenantId = covenantId;
      return db.ref('markets/' + marketId).update({ covenantId: covenantId });
    }).then(function() {
      console.log('[HTP EventCreator] Covenant ID updated:', covenantId);
      W.dispatchEvent(new CustomEvent('htp:market:created', { detail: market }));

      // Clear form
      document.getElementById('event-title').value = '';
      document.getElementById('event-description').value = '';
      document.getElementById('event-resolution-date').value = '';
      document.getElementById('event-source-url').value = '';
      document.getElementById('event-min-position').value = '';
      if (maxPEl) maxPEl.value = '';
      document.getElementById('event-expected-volume').value = '';
      document.getElementById('event-maximizer-limit-pct').value = '';
      document.getElementById('event-oracle-address').value = '';

      // Reset char counters
      if (W.updateCharCounter) {
        W.updateCharCounter('event-title', 120);
        W.updateCharCounter('event-description', 1000);
      }

      // Recompile SilverScript
      if (W.compileSilverScript) W.compileSilverScript();
    }).catch(function(err) {
      console.error('[HTP EventCreator] Firebase error:', err);
      if (W.showToast) W.showToast('Failed to create market: ' + err.message, 'error');
    });
  };

  console.log('[HTP EventCreator] loaded');

  // Fee preview helper - can be called on input change for live preview
  W.previewEventFees = function() {
    var expectedVol = parseFloat(document.getElementById('event-expected-volume').value) || 0;
    var maxPct = parseFloat(document.getElementById('event-maximizer-limit-pct').value) || 0;
    
    if (expectedVol > 0) {
      const regularFees = expectedVol * 0.02;
      const maxFees = expectedVol * (maxPct/100) * 0.3;
      const totalFees = regularFees + maxFees;
      
      // Update fee preview element if it exists
      var feePreview = document.getElementById('event-fee-preview');
      if (feePreview) {
        feePreview.innerHTML = `
          <small><strong>Fee Preview:</strong> ${totalFees.toFixed(2)} KAS total<br></small>
          <small>2% regular (${regularFees.toFixed(2)} KAS) + 30% maximizer cut (${maxFees.toFixed(2)} KAS)</small>
        `;
      }
      return totalFees;
    }
    return 0;
  };
})(window);
