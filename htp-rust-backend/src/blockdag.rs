use anyhow::Result;
use crate::types::*;

/// Fetch recent blocks from the Kaspa REST API.
///
/// Uses the /blocks endpoint to get recent block headers
/// with parent references for DAG visualization.
pub async fn fetch_live_blocks(api_base: &str) -> Result<BlockDAGResponse> {
    let client = reqwest::Client::new();

    // First, get the tip hashes from blockdag info
    let info_url = format!("{}/info/blockdag", api_base);
    let info: KaspaBlockDagInfo = client.get(&info_url)
        .send()
        .await?
        .json()
        .await?;

    let blocks = if let Some(ref tips) = info.tip_hashes {
        if let Some(tip) = tips.first() {
            // Fetch blocks starting from tip
            let blocks_url = format!(
                "{}/blocks?lowHash={}&includeBlocks=true&limit=50",
                api_base, tip
            );
            match client.get(&blocks_url).send().await {
                Ok(resp) => {
                    let body: serde_json::Value = resp.json().await?;
                    parse_blocks_response(&body)
                }
                Err(_) => {
                    // Fallback: try without lowHash
                    let fallback_url = format!("{}/blocks?limit=50", api_base);
                    let resp = client.get(&fallback_url).send().await?;
                    let body: serde_json::Value = resp.json().await?;
                    parse_blocks_response(&body)
                }
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    Ok(BlockDAGResponse { blocks })
}

/// Parse blocks from the Kaspa API response.
///
/// Handles both array format and object-with-blocks format.
fn parse_blocks_response(body: &serde_json::Value) -> Vec<BlockHeader> {
    let blocks_array = if let Some(arr) = body.as_array() {
        arr.clone()
    } else if let Some(arr) = body.get("blocks").and_then(|b| b.as_array()) {
        arr.clone()
    } else {
        return Vec::new();
    };

    blocks_array.iter().filter_map(|block| {
        // Handle nested header format
        let header = block.get("header").unwrap_or(block);
        
        let hash = header.get("hash")
            .or_else(|| block.get("blockHash"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let timestamp = header.get("timestamp")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let parent_hashes = extract_parent_hashes(header, block);

        let blue_score = header.get("blueScore")
            .or_else(|| block.get("blueScore"))
            .and_then(|v| v.as_u64());

        if hash.is_empty() {
            None
        } else {
            Some(BlockHeader {
                hash,
                timestamp,
                parent_hashes,
                blue_score,
            })
        }
    }).collect()
}

/// Extract parent hashes from various API response formats.
fn extract_parent_hashes(header: &serde_json::Value, block: &serde_json::Value) -> Vec<String> {
    // Try header.parents (array of arrays or array of objects)
    if let Some(parents) = header.get("parents").and_then(|p| p.as_array()) {
        let mut hashes = Vec::new();
        for parent in parents {
            if let Some(s) = parent.as_str() {
                hashes.push(s.to_string());
            } else if let Some(arr) = parent.as_array() {
                for h in arr {
                    if let Some(s) = h.as_str() {
                        hashes.push(s.to_string());
                    }
                }
            } else if let Some(obj) = parent.as_object() {
                if let Some(arr) = obj.get("parentHashes").and_then(|h| h.as_array()) {
                    for h in arr {
                        if let Some(s) = h.as_str() {
                            hashes.push(s.to_string());
                        }
                    }
                }
            }
        }
        return hashes;
    }

    // Try block.parentBlockHashes
    if let Some(parents) = block.get("parentBlockHashes").and_then(|p| p.as_array()) {
        return parents.iter()
            .filter_map(|h| h.as_str().map(|s| s.to_string()))
            .collect();
    }

    Vec::new()
}
