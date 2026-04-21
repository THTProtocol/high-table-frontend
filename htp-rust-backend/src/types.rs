use serde::{Deserialize, Serialize};

// ============================================================
// Request / Response types for the HTP Rust backend
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub network: String,
}

// --- Wallet ---

#[derive(Debug, Deserialize)]
pub struct MnemonicRequest {
    pub mnemonic: String,
    pub network: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WalletResponse {
    pub address: String,
    pub public_key: String,
}

#[derive(Debug, Serialize)]
pub struct BalanceResponse {
    pub balance: u64,
    pub balance_kas: String,
    pub utxo_count: u64,
}

// --- Escrow ---

#[derive(Debug, Deserialize)]
pub struct EscrowCreateRequest {
    pub pubkey_a: String,
    pub pubkey_b: String,
    pub network: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EscrowCreateResponse {
    pub escrow_address: String,
    pub script_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct EscrowPayoutRequest {
    pub escrow_address: String,
    pub winner_address: String,
    pub treasury_address: String,
    pub fee_bps: u32,
    pub utxos: Vec<UtxoRef>,
}

#[derive(Debug, Deserialize)]
pub struct EscrowCancelRequest {
    pub escrow_address: String,
    pub player_a_address: String,
    pub player_b_address: String,
    pub utxos: Vec<UtxoRef>,
}

#[derive(Debug, Serialize)]
pub struct TxResponse {
    pub raw_tx: String,
    pub tx_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UtxoRef {
    pub tx_id: String,
    pub index: u32,
    pub amount: u64,
}

// --- BlockDAG ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlockHeader {
    pub hash: String,
    pub timestamp: u64,
    pub parent_hashes: Vec<String>,
    pub blue_score: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct BlockDAGResponse {
    pub blocks: Vec<BlockHeader>,
}

// --- Broadcast ---

#[derive(Debug, Deserialize)]
pub struct BroadcastRequest {
    pub raw_tx: String,
}

#[derive(Debug, Serialize)]
pub struct BroadcastResponse {
    pub tx_id: String,
}

// --- Kaspa REST API types ---

#[derive(Debug, Deserialize)]
pub struct KaspaBalanceResponse {
    pub address: Option<String>,
    pub balance: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KaspaBlockDagInfo {
    pub block_count: Option<u64>,
    pub header_count: Option<u64>,
    pub tip_hashes: Option<Vec<String>>,
    pub difficulty: Option<f64>,
    pub past_median_time: Option<u64>,
    pub virtual_parent_hashes: Option<Vec<String>>,
    pub pruning_point_hash: Option<String>,
    pub virtual_daa_score: Option<u64>,
    pub hashrate: Option<f64>,
    pub block_rate: Option<f64>,
}
