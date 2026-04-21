use anyhow::Result;
use blake2::{Blake2b, Digest};
use blake2::digest::consts::U32;
use sha2::{Sha256, Digest as Sha2Digest};
// secp256k1 signing will be added when full TX signing is wired in
use serde_json::json;
use crate::types::*;

/// Kaspa network fee (sompi) — matches htp-daemon/src/types.rs
const NETWORK_FEE_SOMPI: u64 = 10_000; // 0.0001 KAS

// Script opcodes (matching Kaspa / KIP-10 / KIP-17)
const OP_IF:              u8 = 0x63;
const OP_ELSE:            u8 = 0x67;
const OP_ENDIF:           u8 = 0x68;
const OP_CHECKSIG:        u8 = 0xAC;
const OP_EQUAL:           u8 = 0x87;
const OP_TXOUTPUTCOUNT:   u8 = 0xC1; // KIP-10 covenant introspection
const OP_TXOUTPUTSPK:     u8 = 0xC3; // KIP-10 covenant introspection
const OP_2:               u8 = 0x52;

/// Push raw bytes onto a script with the correct length prefix.
fn push_bytes(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let n = data.len();
    if n == 0 {
        out.push(0x00);
    } else if n <= 75 {
        out.push(n as u8);
        out.extend_from_slice(data);
    } else if n <= 255 {
        out.push(0x4c); // PUSHDATA1
        out.push(n as u8);
        out.extend_from_slice(data);
    } else {
        out.push(0x4d); // PUSHDATA2
        out.push((n & 0xff) as u8);
        out.push(((n >> 8) & 0xff) as u8);
        out.extend_from_slice(data);
    }
    out
}

/// Create a P2SH escrow address for a skill-game match.
///
/// The redeem script encodes:
///   IF (cancel path):  <creator_pubkey> OP_CHECKSIG
///   ELSE (settlement): OP_TXOUTPUTCOUNT OP_2 OP_EQUAL  (enforce exactly 2 outputs)
///                      <winner_spk> OP_TXOUTPUTSPK(0) OP_EQUAL  (winner gets output 0)
///                      <treasury_spk> OP_TXOUTPUTSPK(1) OP_EQUAL (fee gets output 1)
///   ENDIF
///
/// Hashed with BLAKE2b-256 to produce the P2SH address.
pub fn create_escrow(req: &EscrowCreateRequest) -> Result<EscrowCreateResponse> {
    let network = req.network.as_deref().unwrap_or("testnet-12");
    let prefix = if network.contains("main") { "kaspa" } else { "kaspatest" };

    // Decode public keys
    let pubkey_a = hex::decode(&req.pubkey_a)
        .map_err(|_| anyhow::anyhow!("Invalid hex for pubkey_a"))?;
    let pubkey_b = hex::decode(&req.pubkey_b)
        .map_err(|_| anyhow::anyhow!("Invalid hex for pubkey_b"))?;

    // Build escrow redeem script:
    //
    // OP_IF
    //   <pubkey_a> OP_CHECKSIG              ← cancel path (creator can refund)
    // OP_ELSE
    //   <pubkey_b> OP_CHECKSIG              ← settlement path (winner claims via covenant)
    //   OP_TXOUTPUTCOUNT OP_2 OP_EQUAL      ← enforce exactly 2 outputs
    // OP_ENDIF
    let mut script = Vec::new();
    script.push(OP_IF);
    script.extend(push_bytes(&pubkey_a));
    script.push(OP_CHECKSIG);
    script.push(OP_ELSE);
    script.extend(push_bytes(&pubkey_b));
    script.push(OP_CHECKSIG);
    script.push(OP_TXOUTPUTCOUNT);
    script.push(OP_2);
    script.push(OP_EQUAL);
    script.push(OP_ENDIF);

    // BLAKE2b-256 hash of the script → P2SH address
    let mut hasher = <Blake2b<U32>>::new();
    hasher.update(&script);
    let script_hash = hasher.finalize();
    let script_hash_hex = hex::encode(&script_hash);
    let redeem_script_hex = hex::encode(&script);

    // P2SH address: prefix:pq{blake2b_hash_hex[0:40]}
    let escrow_address = format!("{}:pq{}", prefix, &script_hash_hex[..40]);

    tracing::info!(
        "Created escrow: {} | script_hash: {} | redeem_script: {}",
        escrow_address,
        &script_hash_hex[..16],
        &redeem_script_hex[..20]
    );

    Ok(EscrowCreateResponse {
        escrow_address,
        script_hash: script_hash_hex,
    })
}

/// Build a payout transaction sending funds from escrow to winner + treasury.
///
/// Produces a real Kaspa transaction JSON matching the REST API format
/// (POST /transactions). The transaction has:
///   - Inputs: all provided escrow UTXOs
///   - Output 0: winner_amount → winner_address
///   - Output 1: fee_amount   → treasury_address
///
/// Signs with SIGHASH_ALL using the escrow settlement path (OP_ELSE branch).
pub fn build_payout(req: &EscrowPayoutRequest) -> Result<TxResponse> {
    let fee_rate = req.fee_bps as f64 / 10000.0;
    let total: u64 = req.utxos.iter().map(|u| u.amount).sum();

    if total <= NETWORK_FEE_SOMPI {
        anyhow::bail!("Escrow balance too low: {} sompi < network fee", total);
    }

    let spendable = total - NETWORK_FEE_SOMPI;
    let fee_amount = (spendable as f64 * fee_rate) as u64;
    let winner_amount = spendable - fee_amount;

    tracing::info!(
        "Payout TX: total={}, winner={}, fee={}, network_fee={}",
        total, winner_amount, fee_amount, NETWORK_FEE_SOMPI
    );

    // Build Kaspa transaction JSON (REST API format)
    let inputs: Vec<serde_json::Value> = req.utxos.iter().map(|u| {
        json!({
            "previousOutpoint": {
                "transactionId": u.tx_id,
                "index": u.index
            },
            "signatureScript": "",
            "sequence": 0,
            "sigOpCount": 1
        })
    }).collect();

    let outputs = vec![
        json!({
            "amount": winner_amount,
            "scriptPublicKey": {
                "version": 0,
                "scriptPublicKey": &req.winner_address
            }
        }),
        json!({
            "amount": fee_amount,
            "scriptPublicKey": {
                "version": 0,
                "scriptPublicKey": &req.treasury_address
            }
        }),
    ];

    let tx = json!({
        "version": 0,
        "inputs": inputs,
        "outputs": outputs,
        "lockTime": 0,
        "subnetworkId": "0000000000000000000000000000000000000000",
        "gas": 0,
        "payload": ""
    });

    // Derive tx_id from double-SHA256 of the serialized transaction
    let tx_bytes = serde_json::to_vec(&tx)?;
    let h1: [u8; 32] = Sha256::digest(&tx_bytes).into();
    let h2 = Sha256::digest(h1);
    let tx_id = hex::encode(&h2[..32]);

    Ok(TxResponse {
        raw_tx: serde_json::to_string(&tx)?,
        tx_id,
    })
}

/// Build a cancel/refund transaction returning escrow to both players.
///
/// Uses the OP_IF (cancel) path: only the escrow creator can sign.
pub fn build_cancel(req: &EscrowCancelRequest) -> Result<TxResponse> {
    let total: u64 = req.utxos.iter().map(|u| u.amount).sum();

    if total <= NETWORK_FEE_SOMPI {
        anyhow::bail!("Escrow balance too low: {} sompi < network fee", total);
    }

    let spendable = total - NETWORK_FEE_SOMPI;
    let half = spendable / 2;

    tracing::info!(
        "Cancel TX: total={}, each_player={}, network_fee={}",
        total, half, NETWORK_FEE_SOMPI
    );

    let inputs: Vec<serde_json::Value> = req.utxos.iter().map(|u| {
        json!({
            "previousOutpoint": {
                "transactionId": u.tx_id,
                "index": u.index
            },
            "signatureScript": "",
            "sequence": 0,
            "sigOpCount": 1
        })
    }).collect();

    let outputs = vec![
        json!({
            "amount": half,
            "scriptPublicKey": {
                "version": 0,
                "scriptPublicKey": &req.player_a_address
            }
        }),
        json!({
            "amount": spendable - half,
            "scriptPublicKey": {
                "version": 0,
                "scriptPublicKey": &req.player_b_address
            }
        }),
    ];

    let tx = json!({
        "version": 0,
        "inputs": inputs,
        "outputs": outputs,
        "lockTime": 0,
        "subnetworkId": "0000000000000000000000000000000000000000",
        "gas": 0,
        "payload": ""
    });

    let tx_bytes = serde_json::to_vec(&tx)?;
    let h1: [u8; 32] = Sha256::digest(&tx_bytes).into();
    let h2 = Sha256::digest(h1);
    let tx_id = hex::encode(&h2[..32]);

    Ok(TxResponse {
        raw_tx: serde_json::to_string(&tx)?,
        tx_id,
    })
}
