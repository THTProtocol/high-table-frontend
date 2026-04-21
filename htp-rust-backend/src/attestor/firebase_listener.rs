//! htp-rust-backend/src/attestor/firebase_listener.rs
//! Listen to Firebase RTDB for result triggers.

use anyhow::Result;
use serde_json::Value;

pub struct FirebaseListener {
    pub db_url: String,
    pub auth_token: String,
}

impl FirebaseListener {
    pub async fn poll_results(&self) -> Result<Vec<Value>> {
        let client = reqwest::Client::new();
        let url = format!("{}/results.json?auth={}", self.db_url, self.auth_token);
        let resp = client.get(&url).send().await?;
        let data: Value = resp.json().await?;
        let mut results = Vec::new();
        if let Some(obj) = data.as_object() {
            for (_, v) in obj {
                results.push(v.clone());
            }
        }
        Ok(results)
    }
}
