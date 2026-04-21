//! htp-rust-backend/src/attestor/broadcast.rs
//! Broadcast signed transactions via Kaspa TN12 RPC.

use anyhow::Result;

pub async fn broadcast_tx(raw_tx_hex: &str, rpc_url: &str) -> Result<String> {
    // REST API: POST {rpc_url}/transactions
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/transactions", rpc_url))
        .json(&serde_json::json!({ "transaction": raw_tx_hex }))
        .send()
        .await?;
    let body: serde_json::Value = resp.json().await?;
    let tx_id = body["transactionId"].as_str().unwrap_or("unknown");
    Ok(tx_id.to_string())
}
