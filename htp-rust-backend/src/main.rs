//! HTP Rust Backend
//!
//! Axum HTTP server providing native-speed Kaspa transaction construction
//! and wallet operations, replacing the browser WASM module.
//!
//! Default: http://localhost:3000
//! Production: deployed to Cloud Run

mod types;
mod wallet;
mod escrow;
mod blockdag;
mod broadcast;

mod wasm;

use axum::{
    extract::{Path, Json},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use tower_http::cors::CorsLayer;
use std::net::SocketAddr;

/// Kaspa TN12 REST API base URL
const DEFAULT_API_BASE: &str = "https://api-tn12.kaspa.org";

fn api_base() -> String {
    std::env::var("KASPA_API_BASE").unwrap_or_else(|_| DEFAULT_API_BASE.to_string())
}

// ============================================================
// Route Handlers
// ============================================================

/// GET /health
async fn health() -> impl IntoResponse {
    Json(types::HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        network: std::env::var("KASPA_NETWORK").unwrap_or_else(|_| "testnet-12".to_string()),
    })
}

/// POST /wallet/from-mnemonic
async fn wallet_from_mnemonic(
    Json(req): Json<types::MnemonicRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    wallet::derive_from_mnemonic(&req)
        .map(|resp| Json(resp))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

/// GET /wallet/balance/:addr
async fn wallet_balance(
    Path(addr): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    wallet::fetch_balance(&addr, &api_base())
        .await
        .map(|resp| Json(resp))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// POST /escrow/create
async fn escrow_create(
    Json(req): Json<types::EscrowCreateRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    escrow::create_escrow(&req)
        .map(|resp| Json(resp))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

/// POST /escrow/payout
async fn escrow_payout(
    Json(req): Json<types::EscrowPayoutRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    escrow::build_payout(&req)
        .map(|resp| Json(resp))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

/// POST /escrow/cancel
async fn escrow_cancel(
    Json(req): Json<types::EscrowCancelRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    escrow::build_cancel(&req)
        .map(|resp| Json(resp))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

/// GET /blockdag/live
async fn blockdag_live() -> Result<impl IntoResponse, (StatusCode, String)> {
    blockdag::fetch_live_blocks(&api_base())
        .await
        .map(|resp| Json(resp))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// POST /tx/broadcast
async fn tx_broadcast(
    Json(req): Json<types::BroadcastRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    broadcast::broadcast_tx(&req, &api_base())
        .await
        .map(|resp| Json(resp))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

// ============================================================
// Server Setup
// ============================================================

#[tokio::main]
async fn main() {
    // Load .env if present
    let _ = dotenvy::dotenv();

    // Init tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "htp_backend=info,tower_http=info".into()),
        )
        .init();

    let cors = CorsLayer::permissive();

    let app = Router::new()
        .route("/health", get(health))
        .route("/wallet/from-mnemonic", post(wallet_from_mnemonic))
        .route("/wallet/balance/{addr}", get(wallet_balance))
        .route("/escrow/create", post(escrow_create))
        .route("/escrow/payout", post(escrow_payout))
        .route("/escrow/cancel", post(escrow_cancel))
        .route("/blockdag/live", get(blockdag_live))
        .route("/tx/broadcast", post(tx_broadcast))
        .layer(cors);

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse()
        .unwrap_or(3000);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("HTP Rust Backend listening on http://{}", addr);
    tracing::info!("Network: {}", std::env::var("KASPA_NETWORK").unwrap_or_else(|_| "testnet-12".to_string()));
    tracing::info!("API base: {}", api_base());

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
