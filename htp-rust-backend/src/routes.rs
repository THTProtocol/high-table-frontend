use axum::{
    extract::Path,
    Json,
};
use serde_json::json;

fn stub_event_id() -> String {
    format!("evt_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs())
}

pub async fn chess_move(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "chess", "received": payload}))
}

pub async fn checkers_move(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "checkers", "received": payload}))
}

pub async fn connect4_move(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "connect4", "received": payload}))
}

pub async fn poker_action(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "poker", "received": payload}))
}

pub async fn blackjack_action(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "blackjack", "received": payload}))
}

pub async fn coinflip_commit(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "coinflip", "phase": "commit", "received": payload}))
}

pub async fn coinflip_reveal(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "coinflip", "phase": "reveal", "received": payload}))
}

pub async fn rps_commit(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "rps", "phase": "commit", "received": payload}))
}

pub async fn rps_reveal(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "rps", "phase": "reveal", "received": payload}))
}

pub async fn wordduel_guess(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "wordduel", "received": payload}))
}

pub async fn backgammon_state(Path(game_id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "backgammon", "game_id": game_id, "state": {}}))
}

pub async fn backgammon_move(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "backgammon", "action": "move", "received": payload}))
}

pub async fn backgammon_roll(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "game": "backgammon", "action": "roll", "received": payload}))
}

pub async fn escrow_settle(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "route": "/api/escrow/settle", "tx_id": null, "received": payload}))
}

pub async fn escrow_status(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "escrow_id": id, "status": "active", "balance_sompi": 200000000}))
}

pub async fn event_create(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "event_id": stub_event_id(), "received": payload}))
}

pub async fn event_bet(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "route": "/api/event/bet", "received": payload}))
}

pub async fn event_pool(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "event_id": id, "side_a_total": 1000000000u64, "side_b_total": 500000000u64, "total_pool": 1500000000u64}))
}

pub async fn event_settle(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "route": "/api/event/settle", "received": payload}))
}

pub async fn oracle_pubkey() -> Json<serde_json::Value> {
    let pk = std::env::var("ORACLE_PUBLIC_KEY").unwrap_or_else(|_| "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdx5m2j".to_string());
    Json(json!({"ok": true, "address": pk}))
}

pub async fn oracle_attest(Json(payload): Json<serde_json::Value>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "route": "/api/oracle/attest", "received": payload, "sig": "stub_sig"}))
}
