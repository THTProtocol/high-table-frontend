# HTP API Reference

## JS Modules (Browser/Node)

### htp-wallet-v3.js
```javascript
HTPWallet.connect()               // auto-detect extension or mnemonic
HTPWallet.fromMnemonic(mnemonic)  // derive from BIP39
HTPWallet.getBalance()            // returns sompi (BigInt)
HTPWallet.send(to, amountKas)     // amount in KAS float, converted internally
HTPWallet.deriveAddress(index)    // BIP44 path m/44'/111111'/0'/0/index
```

### htp-rpc-client.js
```javascript
window.htpRpc.connect()           // Resolver-only, Borsh encoding
window.htpRpc.getBalance(addr)    // returns BigInt sompi
window.htpRpc.fetchUtxos(addr)    // array of UTXO objects
window.htpRpc.submitTx(rawTxHex)  // returns txId string
window.htpRpc.waitForDaa(target)   // promise resolves at DAA score
```

### htp-covenant-escrow-v2.js
```javascript
HTPEscrow.genEscrowKeyHex()       // 32-byte CSPRNG key
HTPEscrow.buildRedeemScript(escrowPub, creatorPub, feeSpk)  // returns hex
HTPEscrow.buildSettleScriptSig(sig, redeemScript)           // settlement path
HTPEscrow.buildCancelScriptSig(sig, redeemScript)         // cancel path
```

### htp-maximizer-ui.js
```javascript
HTPMaximizer.showBetModal(event)  // Standard vs Maximizer selector
HTPMaximizer.renderProgress(event) // Live used/cap bar
HTPMaximizer.previewHedge(stake) // Show 70/30 split preview
```

### htp-event-creator.js
```javascript
HTPEventCreator.open()            // Show creator form
HTPEventCreator.validate()        // Check fields before submit
HTPEventCreator.getCovenantId()   // Return generated covenant_id
```

## WASM Exports (pkg/htp_rust_backend.js)

```javascript
import init, { WasmCovenantEscrow, calculateFee, calculateWinnerPayout, encodeCovenantId } from './pkg/htp_rust_backend.js';

// Initialize WASM
await init();

// Create escrow
const escrow = new WasmCovenantEscrow("match-1", creatorPubkeyHex, "testnet-12");
escrow.setOpponent(opponentPubkeyHex);
escrow.setAttestor(attestorPubkeyHex);
escrow.setDeadline(blockNumber);
console.log(escrow.getEscrowAddress());
console.log(escrow.getCovenantId());

// Fee calculations (u64)
const fee = calculateFee(totalSompi, 200);      // 2% = 200 bps
const payout = calculateWinnerPayout(total, 200);

// KIP-20 covenant ID
const covId = encodeCovenantId(txId, vout, authOutputsJson);
```

## Rust Crates (htp-rust-backend/src/)

### wasm/covenant_escrow.rs
```rust
CovenantEscrow::new(match_id, creator_pubkey_hex, network)
  .set_opponent(opponent_pubkey_hex)
  .set_attestor(attestor_pubkey_hex)
  .set_deadline(block_number)
  .set_maximizer(true)

build_settlement_tx(utxos, winner_addr, fee_addr, total, fee_bps, network_fee)
build_deadline_tx(utxos, creator_addr, opponent_addr, total, network_fee)
build_cancel_tx(utxos, creator_addr, total, network_fee)
build_leave_tx(utxos, opponent_addr, fee_addr, total, fee_bps, network_fee)
```

### wasm/fee_engine.rs
```rust
FeeEngine::skill_win(pot_sompi) // -> (winner, fee)
FeeEngine::event_win_std(stake, odds_num, odds_den) // -> (winner, fee)
FeeEngine::event_win_max(actual_bet, odds_num, odds_den) // -> (winner, fee)
FeeEngine::hedge_claim(hedge_sompi) // -> (user, fee)
FeeEngine::kas_to_sompi("1.5") // -> 150_000_000
FeeEngine::sompi_to_kas_str(150_000_000) // -> "1.50000000"
```

### wasm/autopayout.rs
```rust
UtxoSelector::select(available, target, fee_buffer) // -> (selected, change)
AutoPayout::skill_payout(inputs, winner_addr, fee_addr, network_fee)
AutoPayout::event_std_payout(inputs, winner_addr, fee_addr, stake, odds_num, odds_den, network_fee)
AutoPayout::hedge_payout(inputs, user_addr, fee_addr, network_fee)
```

### wasm/zk_pipeline.rs
```rust
ZkPipeline::verify_groth16(vk_bytes, proof_bytes, pub_inputs) // -> bool
ZkPipeline::verify_risc_zero(image_id, proof_bytes, journal)   // -> bool
ZkPipeline::game_state_hash(json) // -> blake2b-256 hex
ZkPipeline::deterministic_sign_hash(escrow_id, winner_pubkey, state_hash, daa_score) // -> hex
```

### attestor/mod.rs
```rust
Attestor::sign_deterministic(escrow_id, winner_pubkey_hex, game_state_hash_hex, block_daa_score)
AttestorSet::new(threshold)
AttestorSet::add(attestor)
AttestorSet::has_enough_sigs(sigs)
```

## REST Endpoints (HTP Rust Backend Server)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | /health | - | `{status, version, network}` |
| POST | /wallet/from-mnemonic | `{mnemonic}` | `{address, pubkey}` |
| GET | /wallet/balance/:addr | - | `{sompi, kas}` |
| POST | /escrow/create | `{pubkey_a, pubkey_b, network}` | `{escrow_address, script_hash}` |
| POST | /escrow/payout | `{utxos, winner, fee_addr, fee_bps}` | `{raw_tx, tx_id}` |
| POST | /escrow/cancel | `{utxos, player_a, player_b}` | `{raw_tx, tx_id}` |
| GET | /blockdag/live | - | `{blockHash, daaScore}` |
| POST | /tx/broadcast | `{rawTx}` | `{txId, status}` |

## Game State Events (Firebase)

```javascript
// Listen for game updates
DB.ref('escrows/' + escrowId + '/state').on('value', snap => {
  const state = snap.val(); // FEN, moves, turn
});

// Trigger timeout check
DB.ref('escrows/' + escrowId + '/heartbeat').set({ts: Date.now()});
```

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| HTP-001 | WASM not loaded | Refresh page |
| HTP-002 | Insufficient balance | Top up from faucet |
| HTP-003 | UTXO not found | Wait for confirmations |
| HTP-004 | Covenant script rejected | Check network |
| HTP-005 | Oracle timeout | File dispute |
| HTP-006 | Firebase auth failed | Re-login |
| HTP-007 | Invalid move | Retry valid move |
| HTP-008 | Opponent left | Auto win claimed |
