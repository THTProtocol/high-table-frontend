# Deployment Guide

## Prerequisites

- Node.js 20+
- `serve` CLI (`npm install -g serve`)
- `firebase-tools` (`npm install -g firebase-tools`)
- `cargo` + `wasm-pack` (for Rust builds)

## Local Development

```bash
cd ~/high-table-frontend
serve . -l 8765 --no-clipboard
```

Verify:
```bash
curl -sf http://localhost:8765/ | grep -qi "high table"
```

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `KASPA_NETWORK` | mainnet or testnet-12 | testnet-12 |
| `KASPA_API_BASE` | REST API endpoint | https://api-tn12.kaspa.org |
| `FIREBASE_API_KEY` | Firebase auth API key | (GitHub secret - never commit) |
| `FIREBASE_PROJECT_ID` | Firebase project identifier | hightable420 |
| `ORACLE_PRIVATE_KEY` | Oracle signing key | (GitHub secret - never log actual value) |
| `KASPA_RPC_URL` | RPC endpoint resolver pattern | https://api.mainnet.kaspa.org |

## Environment Variables Reference

### Critical Security Notes

- **ORACLE_PRIVATE_KEY**: NEVER log actual values. Use rotation policies. Store in secure secrets manager.
- **FIREBASE_API_KEY**: While not as sensitive as private keys, keep out of public repos. Rotate quarterly.
- **KASPA_RPC_URL**: Supports failover - use comma-separated endpoints for resolver pattern (e.g., `https://api1.kaspa.org,https://api2.kaspa.org`)

### Local Development

Copy `.env.example` to `.env` and populate with:

```
KASPA_NETWORK=testnet-12
KASPA_API_BASE=https://api-tn12.kaspa.org
FIREBASE_PROJECT_ID=hightable420
# Add secrets via: export ORACLE_PRIVATE_KEY=...
```

## Firebase Deploy

```bash
firebase login --no-localhost
firebase projects:list
firebase use hightable420
firebase deploy --only hosting
```

## CI/CD (GitHub Actions)

Workflows in `.github/workflows/`:
- `ci.yml` — build + test on every push
- `rust-wasm.yml` — compile Rust to WASM
- `oracle-cron.yml` — run oracle every 5 minutes
- `deploy.yml` — auto-deploy on main merge

## Secrets required:
- `FIREBASE_API_KEY`
- `ORACLE_PRIVATE_KEY` (optional for Phase 1)

## Server Port Rules

- **ONLY port 8765** for local dev (`serve . -l 8765`)
- **NEVER touch port 3000** (Perplexica)
- No bundler/vite/webpack
