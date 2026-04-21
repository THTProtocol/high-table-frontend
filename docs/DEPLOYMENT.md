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

| Variable | Purpose | Default |
|----------|---------|---------|
| `KASPA_NETWORK` | mainnet or testnet-12 | testnet-12 |
| `KASPA_API_BASE` | REST API endpoint | https://api-tn12.kaspa.org |
| `FIREBASE_TOKEN` | Firebase auth token | (GitHub secret) |
| `ATTESTOR_KEY` | Oracle signing key | (GitHub secret, optional) |

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

Secrets required:
- `FIREBASE_TOKEN`
- `ATTESTOR_KEY` (optional for Phase 1)

## Server Port Rules

- **ONLY port 8765** for local dev (`serve . -l 8765`)
- **NEVER touch port 3000** (Perplexica)
- No bundler/vite/webpack
