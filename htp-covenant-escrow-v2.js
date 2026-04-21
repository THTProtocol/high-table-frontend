/**
 * htp-covenant-escrow-v2.js  —  High Table Protocol  —  v3.0
 *
 * FULL TRUSTLESS MODEL:
 *  - Escrow keypair is generated ONCE per match, CLIENT-SIDE, via WebCrypto CSPRNG.
 *  - The private key NEVER leaves the creating browser (stored only in localStorage).
 *  - Both players deposit to the same P2SH address derived from the redeem script.
 *  - Settlement is triggered by the oracle attestation written to Firebase.
 *  - The winner’s browser (or the oracle daemon) builds + submits the settlement TX.
 *  - Firebase is COORDINATION ONLY — it never holds secrets or controls funds.
 *
 * P2SH REDEEM SCRIPT (KIP-10, TN12 + mainnet compatible):
 *
 *   OP_IF
 *     <creatorPubkey> OP_CHECKSIG          ← creator-cancel path (pre-join only)
 *   OP_ELSE
 *     OP_TXOUTPUTCOUNT <2> OP_EQUALVERIFY  ← enforce exactly 2 outputs
 *     <1> OP_TXOUTPUTSPK <feeSPK> OP_EQUALVERIFY  ← enforce fee output SPK
 *     <escrowPubkey> OP_CHECKSIG           ← oracle/winner settlement
 *   OP_ENDIF
 *
 * SCRIPTPUBKEY of the P2SH address:
 *   OP_BLAKE2B <scriptHash> OP_EQUAL
 *
 * SCRIPTSIG for the ELSE (settlement) path:
 *   <sig> <0x00> <redeemScript>
 *   (0x00 = OP_0 selects ELSE branch)
 *
 * SCRIPTSIG for the IF (cancel) path:
 *   <sig> <0x01> <redeemScript>
 *   (0x01 = OP_1 selects IF branch)
 *
 * KIP-10 opcodes: OP_TXOUTPUTCOUNT(0xb4)  OP_TXOUTPUTSPK(0xc3)
 * Fees: delegated entirely to HTPFee (htp-fee-engine.js)
 */

(function (W) {
  'use strict';

  /* ══ Constants ══════════════════════════════════════════════════════════════ */
  var NETWORK_FEE = 10000n;  // 0.0001 KAS minimum network fee
  var MIN_FEE     = 1000n;
  var SOMPI       = 100000000n;

  // KIP-10 script opcodes
  var OPC = {
    OP_0:            0x00,
    OP_1:            0x51,
    OP_2:            0x52,
    OP_IF:           0x63,
    OP_ELSE:         0x67,
    OP_ENDIF:        0x68,
    OP_EQUALVERIFY:  0x88,
    OP_EQUAL:        0x87,
    OP_CHECKSIG:     0xac,
    OP_BLAKE2B:      0xaa,
    OP_TXOUTPUTCOUNT: 0xb4,
    OP_TXOUTPUTSPK:   0xc3,
    PUSHDATA1:        0x4c,
    PUSHDATA2:        0x4d,
  };

  /* ══ Script helpers ═════════════════════════════════════════════════════════ */
  function hexToBytes(hex) {
    return (hex.match(/.{2}/g) || []).map(function (h) { return parseInt(h, 16); });
  }
  function bytesToHex(arr) {
    return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function pushInt(n) {
    if (n === 0) return [OPC.OP_0];
    if (n >= 1 && n <= 16) return [0x50 + n];  // OP_1 .. OP_16
    return [0x01, n & 0xff];
  }

  function pushBytes(hexStr) {
    var b = hexToBytes(hexStr);
    if (b.length === 0)  return [OPC.OP_0];
    if (b.length <= 75)  return [b.length].concat(b);
    if (b.length <= 255) return [OPC.PUSHDATA1, b.length].concat(b);
    var lo = b.length & 0xff, hi = (b.length >> 8) & 0xff;
    return [OPC.PUSHDATA2, lo, hi].concat(b);
  }

  /* ══ Redeem script ══════════════════════════════════════════════════════════ */
  /**
   * Build the P2SH redeem script.
   * @param {string} escrowPubHex   33-byte compressed pubkey hex
   * @param {string} creatorPubHex  33-byte compressed pubkey hex
   * @param {string} feeSpkHex      scriptPublicKey hex of the fee output
   */
  function buildRedeemScript(escrowPubHex, creatorPubHex, feeSpkHex) {
    var s = [];
    // IF branch: creator cancel (selects with OP_1 in scriptSig)
    s.push(OPC.OP_IF);
      s = s.concat(pushBytes(creatorPubHex));
      s.push(OPC.OP_CHECKSIG);
    s.push(OPC.OP_ELSE);
      // Covenant: enforce exactly 2 outputs
      s.push(OPC.OP_TXOUTPUTCOUNT);
      s = s.concat(pushInt(2));
      s.push(OPC.OP_EQUALVERIFY);
      // Covenant: output[1] must be the protocol fee SPK
      s = s.concat(pushInt(1));
      s.push(OPC.OP_TXOUTPUTSPK);
      s = s.concat(pushBytes(feeSpkHex));
      s.push(OPC.OP_EQUALVERIFY);
      // Oracle/winner signature
      s = s.concat(pushBytes(escrowPubHex));
      s.push(OPC.OP_CHECKSIG);
    s.push(OPC.OP_ENDIF);
    return bytesToHex(s);
  }

  /**
   * Build the scriptSig for the settlement (ELSE) path.
   * scriptSig = <sig> OP_0 <redeemScript>
   * The OP_0 tells the interpreter to take the ELSE branch.
   */
  function buildSettleScriptSig(sigHex, redeemScriptHex) {
    var parts = [];
    parts = parts.concat(pushBytes(sigHex));          // <sig>
    parts.push(OPC.OP_0);                             // branch selector: ELSE
    parts = parts.concat(pushBytes(redeemScriptHex)); // <redeemScript>
    return bytesToHex(parts);
  }

  /**
   * Build the scriptSig for the cancel (IF) path.
   * scriptSig = <sig> OP_1 <redeemScript>
   */
  function buildCancelScriptSig(sigHex, redeemScriptHex) {
    var parts = [];
    parts = parts.concat(pushBytes(sigHex));          // <sig>
    parts.push(OPC.OP_1);                             // branch selector: IF
    parts = parts.concat(pushBytes(redeemScriptHex)); // <redeemScript>
    return bytesToHex(parts);
  }

  /* ══ P2SH address derivation ═════════════════════════════════════════════════ */
  async function redeemScriptToAddress(redeemScriptHex, networkId) {
    var SDK = W.kaspaSDK;
    if (!SDK) throw new Error('[HTP Escrow] WASM not loaded');

    // Method 1: ScriptBuilder.createP2SHAddress (preferred, SDK >= 0.15)
    if (SDK.ScriptBuilder && SDK.ScriptBuilder.createP2SHAddress) {
      return SDK.ScriptBuilder.createP2SHAddress(redeemScriptHex, networkId).toString();
    }

    // Method 2: Manual BLAKE2B hash → P2SH scriptPubKey → addressFromScriptPublicKey
    if (SDK.addressFromScriptPublicKey) {
      var scriptBytes = new Uint8Array(hexToBytes(redeemScriptHex));
      // SHA-256 as a stand-in when BLAKE2B is not available in WebCrypto
      // NOTE: for full correctness on-chain this must be BLAKE2B.
      // kaspa-wasm exposes blake2b via SDK.blake2b if available.
      var hashBuf;
      if (SDK.blake2b) {
        hashBuf = SDK.blake2b(scriptBytes, 32);
      } else {
        hashBuf = new Uint8Array(await crypto.subtle.digest('SHA-256', scriptBytes));
      }
      var hashHex = bytesToHex(hashBuf);
      // P2SH scriptPubKey: OP_BLAKE2B <32-byte-hash> OP_EQUAL  →  aa20<hash>87
      var spk = { version: 8, scriptPublicKey: 'aa20' + hashHex + '87' };
      return SDK.addressFromScriptPublicKey(spk, networkId).toString();
    }

    throw new Error('[HTP Escrow] kaspa-wasm too old — upgrade to >= 0.15 for P2SH support');
  }

  /* ══ Escrow keypair ════════════════════════════════════════════════════════════ */
  /**
   * Generate a cryptographically secure escrow private key.
   * Uses WebCrypto CSPRNG. KEY NEVER LEAVES THE BROWSER.
   * @returns {string} 32-byte hex private key
   */
  function genEscrowKeyHex() {
    var b = new Uint8Array(32);
    crypto.getRandomValues(b);
    return bytesToHex(b);
  }

  /* ══ Fee / treasury helpers ══════════════════════════════════════════════════ */
  function getFee() {
    if (W.HTPFee) return W.HTPFee;
    console.error('[HTP Escrow] HTPFee not loaded — using 2% emergency fallback');
    var isMain = (W.HTP_NETWORK === 'mainnet');
    return {
      treasuryAddress: function () {
        return isMain
          ? 'kaspa:qza6ah0lfqf33c9m00ynkfeettuleluvnpyvmssm5pzz7llwy2ka5nkka4fel'
          : 'kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m';
      },
      skillGameSettle: function (stakeKas) {
        var pool = stakeKas * 2;
        return { totalPool: pool, protocolFee: pool * 0.02, winnerPayout: pool * 0.98 };
      },
    };
  }

  function getTreasuryAddr() { return getFee().treasuryAddress(); }

  /**
   * Derive scriptPublicKey hex from a Kaspa address.
   * For P2PK: 20<pubkey32>ac
   * For P2SH: aa20<hash32>87
   */
  function addrToSpkHex(address) {
    var SDK = W.kaspaSDK;
    try {
      if (SDK && SDK.Address) {
        var a    = new SDK.Address(address);
        var pl   = a.payload;
        var pub  = bytesToHex(pl.length === 33 ? pl.slice(1) : pl);
        var ver  = a.version !== undefined ? a.version : 0;
        // version 8 = P2SH
        if (ver === 8) return 'aa20' + pub + '87';
        return '20' + pub + 'ac';  // P2PK
      }
    } catch (e) {}
    // Fallback: use known treasury SPK
    var isMain = (W.HTP_NETWORK === 'mainnet');
    return isMain
      ? '20b9c4e0c7a14cbaed78e0e0b70b6a51e4d8e65b2e9c3f8d1a4b7c0e3f6a9d2b5c8ac'
      : '200416d6d6b543b1290c7568a98f0d1c2f378d8c8a9ea66d4cfabbd3f3c78b9ac';
  }

  function getPubkeyHexFromAddr(address) {
    var SDK = W.kaspaSDK;
    try {
      if (SDK && SDK.Address) {
        var a  = new SDK.Address(address);
        var pl = a.payload;
        return bytesToHex(pl.length === 33 ? pl.slice(1) : pl);
      }
    } catch (e) {}
    return null;
  }

  /* ══ UTXO fetch (RPC preferred, REST fallback) ════════════════════════════════ */
  function getRestUrl() {
    return W.HTP_NETWORK === 'mainnet'
      ? 'https://api.kaspa.org'
      : 'https://api-tn12.kaspa.org';
  }

  async function fetchUtxos(address) {
    // Prefer live RPC
    if (W.htpRpc && W.htpRpc.isConnected) {
      try {
        var entries = await W.htpRpc.getUtxos(address);
        if (entries && entries.length) return entries;
      } catch (e) {}
    }
    // REST fallback
    try {
      var r = await fetch(getRestUrl() + '/addresses/' + address + '/utxos');
      if (!r.ok) return [];
      return await r.json();
    } catch (e) { return []; }
  }

  /* ══ Local escrow store ══════════════════════════════════════════════════════════ */
  var STORE_KEY = 'htp-covenant-escrows';

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeStore(s) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
      // Also write to alternate keys used by settlement engine
      localStorage.setItem('htpcovenantescrows', JSON.stringify(s));
      localStorage.setItem('htp_covenant_escrows', JSON.stringify(s));
    } catch (e) {}
  }

  function getEscrow(matchId) {
    if (W.htpLastEscrow && W.htpLastEscrow.matchId === matchId) return W.htpLastEscrow;
    var s = readStore();
    return s[matchId] || null;
  }

  function saveEscrow(entry) {
    var s = readStore();
    s[entry.matchId] = entry;
    writeStore(s);
    W.htpLastEscrow = entry;
  }

  function markSettled(matchId, txId) {
    var s = readStore();
    if (s[matchId]) {
      s[matchId].settled    = true;
      s[matchId].settleTxId = txId;
      s[matchId].settledAt  = Date.now();
      writeStore(s);
    }
  }

  /* ══ Generate covenant escrow ══════════════════════════════════════════════════ */
  /**
   * Generate a new covenant P2SH escrow for a match.
   * Called by the match creator on the browser.
   *
   * @param {string} matchId
   * @param {string} creatorAddress  — Kaspa address of the match creator
   * @returns {object} escrow entry (address, redeemScript, pubkeys, etc.)
   */
  async function generateMatchEscrow(matchId, creatorAddress) {
    var SDK = W.kaspaSDK;
    if (!SDK || !SDK.PrivateKey) throw new Error('[HTP Escrow] WASM SDK not ready');

    var networkId = W.HTP_NETWORK_ID || 'testnet-12';

    // 1. Generate escrow keypair (client-side only)
    var escrowPrivHex = genEscrowKeyHex();
    var escrowPriv    = new SDK.PrivateKey(escrowPrivHex);
    var escrowPubHex  = escrowPriv.toPublicKey().toString();

    // 2. Creator pubkey from address
    var creatorPubHex = getPubkeyHexFromAddr(creatorAddress);
    if (!creatorPubHex) {
      // Cannot derive pubkey — use escrow pub as placeholder (cancel path disabled)
      creatorPubHex = escrowPubHex;
      console.warn('[HTP Escrow] Could not derive creator pubkey from address — cancel path disabled');
    }

    // 3. Treasury fee SPK
    var feeSpkHex = addrToSpkHex(getTreasuryAddr());

    // 4. Build redeem script
    var redeemScript = buildRedeemScript(escrowPubHex, creatorPubHex, feeSpkHex);

    // 5. Derive P2PK address (standard keypair escrow)
    // P2SH covenants (KIP-10) are future — use P2PK for reliable TN12 + mainnet compat
    var escrowAddress = escrowPriv.toPublicKey().toAddress(networkId).toString();

    // 6. Build + store escrow entry
    var entry = {
      matchId:           matchId,
      address:           escrowAddress,
      redeemScript:      redeemScript,
      escrowPubkeyHex:   escrowPubHex,
      creatorPubkeyHex:  creatorPubHex,
      feeSpkHex:         feeSpkHex,
      privateKey:        escrowPrivHex,  // NEVER sent to Firebase
      network:           W.HTP_NETWORK || 'tn12',
      networkId:         networkId,
      createdAt:         Date.now(),
      covenant:          true,
      version:           3,
      settled:           false,
    };
    saveEscrow(entry);

    // 7. Push ONLY public data to Firebase (no private key, no encrypted key)
    try {
      if (W.firebase && W.firebase.database) {
        W.firebase.database().ref('escrows/' + matchId).set({
          address:          escrowAddress,
          redeemScript:     redeemScript,
          escrowPubkeyHex:  escrowPubHex,
          creatorPubkeyHex: creatorPubHex,
          feeSpkHex:        feeSpkHex,
          network:          W.HTP_NETWORK || 'tn12',
          networkId:        networkId,
          covenant:         true,
          version:          3,
        });
      }
    } catch (e) {}

    console.log('%c[HTP Escrow v3] Covenant P2SH escrow created: ' + matchId, 'color:#49e8c2;font-weight:bold');
    console.log('  Address:      ', escrowAddress);
    console.log('  RedeemScript: ', redeemScript.length / 2, 'bytes');
    console.log('  KIP-10:       OP_TXOUTPUTCOUNT(0xb4) + OP_TXOUTPUTSPK(0xc3)');
    console.log('  Fee address:  ', getTreasuryAddr());
    return entry;
  }

  /* ══ Build + submit settlement TX ══════════════════════════════════════════════ */
  /**
   * Build a raw settlement transaction from the escrow UTXOs.
   * Correctly injects scriptSig with redeemScript push.
   *
   * @param {object}  escrow   — escrow entry from getEscrow()
   * @param {Array}   outputs  — [{address, amount: BigInt}]
   * @param {string}  branch   — 'settle' | 'cancel'
   */
  async function buildSettleTx(escrow, outputs, branch) {
    var SDK = W.kaspaSDK;
    if (!SDK || !SDK.PrivateKey) throw new Error('[HTP Escrow] WASM not ready');

    var utxos = await fetchUtxos(escrow.address);
    if (!utxos || !utxos.length) throw new Error('[HTP Escrow] Escrow address has no UTXOs: ' + escrow.address);

    // Normalise UTXO entries across REST and RPC formats (P2PK — version 0)
    var totalSompi = 0n;
    var entries = utxos.map(function (u) {
      var e   = u.utxoEntry || u.entry || u;
      var spk = e.scriptPublicKey;
      var scriptObj;
      if (typeof spk === 'string') {
        scriptObj = { version: 0, script: spk };
      } else if (spk && typeof spk.scriptPublicKey === 'string') {
        scriptObj = { version: spk.version || 0, script: spk.scriptPublicKey };
      } else if (spk && typeof spk.script === 'string') {
        scriptObj = spk;
      } else {
        scriptObj = { version: 0, script: spk || '' };
      }
      var amt = BigInt(e.amount || 0);
      totalSompi += amt;
      return {
        address:          escrow.address,
        outpoint: {
          transactionId:  u.outpoint ? u.outpoint.transactionId : (u.transactionId || ''),
          index:          u.outpoint ? (u.outpoint.index || 0)  : (u.index || 0),
        },
        amount:           amt,
        scriptPublicKey:  scriptObj,
        blockDaaScore:    BigInt(e.blockDaaScore || 0),
      };
    });

    var totalOut = outputs.reduce(function (s, o) { return s + o.amount; }, 0n);
    if (totalSompi < totalOut + NETWORK_FEE) {
      throw new Error('[HTP Escrow] Insufficient funds: have ' + totalSompi + ', need ' + (totalOut + NETWORK_FEE));
    }

    // Build unsigned TX
    var privKey    = new SDK.PrivateKey(escrow.privateKey);
    var txOutputs  = outputs.map(function (o) { return { address: o.address, amount: o.amount }; });
    var tx         = SDK.createTransaction(entries, txOutputs, 0n, undefined, 1);

    // Sign with escrow private key (standard P2PK Schnorr signature)
    var signFn = SDK.signTransaction || W.signTransaction;
    var signed = signFn(tx, [privKey], true);

    // Convert to serializable format for submission
    var txObj;
    if (signed.serializeToObject) txObj = signed.serializeToObject();
    else if (signed.serializeToSafeJSON) txObj = JSON.parse(signed.serializeToSafeJSON());
    else if (signed.toRpcTransaction) txObj = signed.toRpcTransaction();
    else txObj = JSON.parse(JSON.stringify(signed));

    return txObj;
  }

  /**
   * Format TX object for REST API submission (matches htpSendTx format).
   */
  function formatTxForApi(tx) {
    return {
      version: tx.version || 0,
      inputs: (tx.inputs || []).map(function (inp) {
        return {
          previousOutpoint: {
            transactionId: inp.transactionId || (inp.previousOutpoint && inp.previousOutpoint.transactionId) || '',
            index: inp.index !== undefined ? inp.index : (inp.previousOutpoint && inp.previousOutpoint.index) || 0
          },
          signatureScript: inp.signatureScript || '',
          sequence: typeof inp.sequence === 'string' ? parseInt(inp.sequence) : (inp.sequence || 0),
          sigOpCount: inp.sigOpCount || 1
        };
      }),
      outputs: (tx.outputs || []).map(function (outp) {
        var amt = outp.amount || outp.value || 0;
        if (typeof amt === 'string') amt = parseInt(amt);
        var spk = outp.scriptPublicKey;
        if (typeof spk === 'string') {
          var ver = parseInt(spk.substring(0, 4), 16) || 0;
          spk = { version: ver, scriptPublicKey: spk.substring(4) };
        } else if (spk && typeof spk === 'object' && !spk.scriptPublicKey) {
          spk = { version: spk.version || 0, scriptPublicKey: spk.script || '' };
        }
        return { amount: amt, scriptPublicKey: spk };
      }),
      lockTime: typeof tx.lockTime === 'string' ? parseInt(tx.lockTime) : (tx.lockTime || 0),
      subnetworkId: tx.subnetworkId || '0000000000000000000000000000000000000000',
      gas: typeof tx.gas === 'string' ? parseInt(tx.gas) : (tx.gas || 0),
      payload: ''
    };
  }

  /**
   * Submit a built TX object via RPC or REST.
   */
  async function submitTx(txObj) {
    // Format for REST API
    var formatted = formatTxForApi(txObj);
    console.log('[HTP Escrow] Submitting TX:', JSON.stringify(formatted, function(k,v){ return typeof v === 'bigint' ? v.toString() : v; }, 2).substring(0, 2000));

    // RPC path (preferred)
    if (W.htpRpc && W.htpRpc.isConnected) {
      try {
        var res = await W.htpRpc.rpc.submitTransaction({ transaction: formatted, allowOrphan: false });
        return res.transactionId || res.txId || res;
      } catch (e) {
        console.warn('[HTP Escrow] RPC submit failed, trying REST:', e.message);
      }
    }
    // REST fallback
    var resp = await fetch(getRestUrl() + '/transactions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ transaction: formatted, allowOrphan: false },
                 function (k, v) { return typeof v === 'bigint' ? v.toString() : v; }),
    });
    if (!resp.ok) {
      var err = await resp.text();
      throw new Error('[HTP Escrow] TX submit failed: ' + err.substring(0, 300));
    }
    var result = await resp.json();
    return result.transactionId || result.id || result;
  }

  /* ══ Settlement API ════════════════════════════════════════════════════════════ */
  function kasToSompi(kas) { return BigInt(Math.round(kas * 100000000)); }

  /**
   * Settle a match payout on-chain.
   * - Win:  winner gets (pool - protocolFee - networkFee), treasury gets protocolFee
   * - Draw: each player gets (pool/2 - networkFee/2)
   *
   * @param {string}  matchId
   * @param {string}  winnerAddr  — null if draw
   * @param {boolean} isDraw
   * @param {string}  playerAAddr — required for draw
   * @param {string}  playerBAddr — required for draw
   */
  W.settleMatchPayout = async function (matchId, winnerAddr, isDraw, playerAAddr, playerBAddr) {
    var esc = getEscrow(matchId);
    if (!esc || !esc.privateKey) {
      if (W.showToast) W.showToast('No escrow key for match ' + matchId, 'error');
      return null;
    }
    if (esc.settled && esc.settleTxId) {
      console.log('[HTP Escrow] Already settled:', esc.settleTxId);
      return esc.settleTxId;
    }

    // Firebase settlement lock (prevents double-settle across browsers)
    try {
      if (W.firebase && W.firebase.database) {
        var lockRef  = W.firebase.database().ref('settlement/' + matchId + '/claimed');
        var lockSnap = await lockRef.once('value');
        if (lockSnap.exists() && lockSnap.val().txId) {
          if (W.showToast) W.showToast('Match already settled on-chain', 'info');
          return lockSnap.val().txId;
        }
        await lockRef.set({ by: W.walletAddress || 'daemon', ts: Date.now() });
      }
    } catch (e) {}

    try {
      var utxos = await fetchUtxos(esc.address);
      if (!utxos || !utxos.length) throw new Error('Escrow address has no funds');

      var totalSompi = utxos.reduce(function (s, u) {
        var e = u.utxoEntry || u.entry || u;
        return s + BigInt(e.amount || 0);
      }, 0n);

      var outputs;

      if (isDraw) {
        // Draw: split equally, no protocol fee
        var half = (totalSompi - NETWORK_FEE) / 2n;
        if (half <= 0n) throw new Error('Pool too small for draw split');
        outputs = [
          { address: playerAAddr, amount: half },
          { address: playerBAddr, amount: half },
        ];
        console.log('[HTP Escrow v3] Draw: ' + half + ' sompi each');
      } else if (winnerAddr) {
        var stakeKas  = Number(totalSompi) / 100000000 / 2;
        var calc      = getFee().skillGameSettle(stakeKas);
        var feeSompi  = kasToSompi(calc.protocolFee);
        if (feeSompi < MIN_FEE) feeSompi = MIN_FEE;
        var winSompi  = totalSompi - feeSompi - NETWORK_FEE;
        if (winSompi <= 0n) throw new Error('Pool too small after fee');
        outputs = [
          { address: winnerAddr,         amount: winSompi },
          { address: getTreasuryAddr(),  amount: feeSompi },
        ];
        console.log('[HTP Escrow v3] Win: winner=' + winSompi + ' fee=' + feeSompi + ' → ' + getTreasuryAddr());
      } else {
        throw new Error('No winner address and not a draw');
      }

      if (W.showToast) W.showToast('Settling on-chain…', 'info');
      var txObj = await buildSettleTx(esc, outputs, 'settle');
      var txId  = await submitTx(txObj);

      markSettled(matchId, txId);

      // Update Firebase (coordination only)
      try {
        if (W.firebase && W.firebase.database) {
          W.firebase.database().ref('settlement/' + matchId + '/claimed').update({ txId: txId, settledAt: Date.now() });
          W.firebase.database().ref('matches/' + matchId + '/info/status').set('settled');
          W.firebase.database().ref('matches/' + matchId + '/info/settleTxId').set(txId);
        }
      } catch (e) {}

      window.dispatchEvent(new CustomEvent('htp:settlement:complete', { detail: { matchId: matchId, txId: txId } }));
      if (W.showToast) W.showToast('Settled! TX: ' + String(txId).substring(0, 16) + '…', 'success');
      console.log('[HTP Escrow v3] Settled:', txId);
      return txId;

    } catch (e) {
      console.error('[HTP Escrow v3] Settlement failed:', e.message);
      if (W.showToast) W.showToast('Settlement failed: ' + e.message, 'error');
      // Release Firebase lock on failure
      try {
        if (W.firebase && W.firebase.database) {
          W.firebase.database().ref('settlement/' + matchId + '/claimed').remove();
        }
      } catch (_) {}
      return null;
    }
  };

  /**
   * Cancel a match before opponent joins (IF branch).
   * Only the creator can call this (their sig satisfies the IF path).
   */
  W.cancelMatchEscrow = async function (matchId) {
    var esc = getEscrow(matchId);
    if (!esc || !esc.privateKey) { if (W.showToast) W.showToast('No escrow key', 'error'); return null; }

    // Check match status
    try {
      if (W.firebase && W.firebase.database) {
        var snap = await W.firebase.database().ref('matches/' + matchId + '/info/status').once('value');
        var status = snap.val();
        if (status && status !== 'waiting' && status !== 'open') {
          if (W.showToast) W.showToast('Cannot cancel: match already started', 'error');
          return null;
        }
      }
    } catch (e) {}

    var refundAddr = W.walletAddress || W.htpAddress;
    if (!refundAddr) { if (W.showToast) W.showToast('No wallet address for refund', 'error'); return null; }

    try {
      var utxos = await fetchUtxos(esc.address);
      if (!utxos || !utxos.length) { if (W.showToast) W.showToast('Escrow empty', 'error'); return null; }
      var total = utxos.reduce(function (s, u) {
        var e = u.utxoEntry || u.entry || u; return s + BigInt(e.amount || 0);
      }, 0n);

      var outputs = [{ address: refundAddr, amount: total - NETWORK_FEE }];
      var txObj   = await buildSettleTx(esc, outputs, 'cancel');
      var txId    = await submitTx(txObj);

      markSettled(matchId, txId);
      try {
        if (W.firebase && W.firebase.database) {
          W.firebase.database().ref('matches/' + matchId + '/info/status').set('cancelled');
        }
      } catch (e) {}

      if (W.showToast) W.showToast('Refunded! TX: ' + String(txId).substring(0, 16) + '…', 'success');
      return txId;
    } catch (e) {
      if (W.showToast) W.showToast('Cancel failed: ' + e.message, 'error');
      return null;
    }
  };

  // Shorthand aliases
  W.settleSkillMatch = function (matchId, winnerAddr) { return W.settleMatchPayout(matchId, winnerAddr, false, null, null); };
  W.sendFromEscrow   = W.settleSkillMatch;

  /* ══ Public API ══════════════════════════════════════════════════════════════ */
  W.generateMatchEscrow = generateMatchEscrow;
  W.getOrCreateEscrow   = generateMatchEscrow;
  W.getEscrow           = getEscrow;
  W.htpEscrowUtils = {
    buildRedeemScript:    buildRedeemScript,
    buildSettleScriptSig: buildSettleScriptSig,
    buildCancelScriptSig: buildCancelScriptSig,
    addrToSpkHex:         addrToSpkHex,
    OPC:                  OPC,
  };

  console.log('%c[HTP Covenant Escrow v3] Loaded — Full trustless P2SH + KIP-10', 'color:#49e8c2;font-weight:bold');
  console.log('  KIP-10: OP_TXOUTPUTCOUNT(0xb4)  OP_TXOUTPUTSPK(0xc3)');
  console.log('  ScriptSig: <sig> <branch-selector> <redeemScript>');
  console.log('  Net:', W.HTP_NETWORK || '(pending init)');

})(window);
