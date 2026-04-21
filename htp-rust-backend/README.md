# HTP Rust Backend

Native-speed Kaspa transaction construction and wallet operations, replacing the browser WASM module.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check, version, network |
| POST | `/wallet/from-mnemonic` | Derive address from BIP39 mnemonic |
| GET | `/wallet/balance/:addr` | Fetch UTXO balance |
| POST | `/escrow/create` | Construct P2SH escrow address |
| POST | `/escrow/payout` | Build winner payout transaction |
| POST | `/escrow/cancel` | Build refund transaction |
| GET | `/blockdag/live` | Stream recent block headers |
| POST | `/tx/broadcast` | Broadcast raw transaction |

## Setup

```bash
cp .env.example .env
cargo build --release
./target/release/htp-backend
```

Server starts on `http://localhost:3000` by default.

## Frontend Integration

The frontend detects the Rust backend availability via a `/health` ping on init:

```javascript
fetch('http://localhost:3000/health')
  .then(r => r.json())
  .then(d => {
    if (d.status === 'ok') {
      window.HTP_BACKEND = 'http://localhost:3000';
      console.log('[HTP] Rust backend detected:', d.version);
    }
  })
  .catch(() => {
    console.log('[HTP] Rust backend not available, using WASM fallback');
  });
```

## Architecture

- **wallet.rs** - BIP39 mnemonic derivation, balance lookup via REST API
- **escrow.rs** - P2SH address construction, payout/cancel transaction building
- **blockdag.rs** - Block fetching and DAG data streaming
- **broadcast.rs** - Transaction broadcasting
- **types.rs** - Shared request/response types

## TODO

- Integrate kaspa-wallet-core for proper HD key derivation
- Integrate kaspa-consensus-core for native transaction construction
- Add WebSocket support for real-time block streaming
- Implement proper Bech32 address encoding
- Add authentication for sensitive endpoints
- Deploy to Cloud Run with proper secrets management
