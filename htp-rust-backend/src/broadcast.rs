use anyhow::Result;
use serde_json::json;
use crate::types::*;

/// Broadcast a raw transaction to the Kaspa network via REST API.
///
/// Uses POST /transactions with the transaction wrapped in the
/// standard Kaspa RPC format: { "transaction": <tx>, "allowOrphan": false }
pub async fn broadcast_tx(req: &BroadcastRequest, api_base: &str) -> Result<BroadcastResponse> {
    let client = reqwest::Client::new();

    // Parse the raw_tx JSON and wrap it in the Kaspa REST submission format
    let tx_value: serde_json::Value = serde_json::from_str(&req.raw_tx)
        .map_err(|e| anyhow::anyhow!("Invalid raw_tx JSON: {}", e))?;

    let body = json!({
        "transaction": tx_value,
        "allowOrphan": false
    });

    let url = format!("{}/transactions", api_base);
    let resp = client.post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Broadcast failed ({}): {}", status, body);
    }

    let result: serde_json::Value = resp.json().await?;
    let tx_id = result.get("transactionId")
        .or_else(|| result.get("txId"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(BroadcastResponse { tx_id })
}
