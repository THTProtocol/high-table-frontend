# High Table Protocol (HTP) v6

![HTP](htp-logo-data.js) *(Logo embedded in JS)*

**Trustless peer-to-peer betting platform on Kaspa TN12.**

| Property | Value |
|----------|-------|
| **Network** | Kaspa Testnet-12 (Toccata) |
| **Consensus** | Proof-of-Work, 1s block times |
| **Encoding** | Borsh only |
| **Covenants** | KIP-17 / KIP-20 |
| **ZK Support** | KIP-16 (Groth16 + RISC-Zero) |
| **Fee Model** | 2% on wins, 30% on hedge claims |
| **Money** | u64 SOMPI (1 KAS = 100M sompi) |

## Quickstart

```bash
git clone https://github.com/THTProtocol/high-table-frontend.git
cd high-table-frontend
serve . -l 8765
# Open http://localhost:8765
```

**No bundler. No webpack. No vite.** Flat files + wasm-pack for Rust.

## Supported Games

| Game | Status | Engine |
|------|--------|--------|
| Chess | Live | JS + Rust validation |
| Checkers | Live | JS + Rust validation |
| Connect Four | Live | JS + Rust validation |
| Backgammon | Live | Rust WASM |
| Rock Paper Scissors | Live | Commit-reveal (Rust) |
| Coin Flip | Live | Block-hash entropy (Rust) |
| Word Duel | Live | Block-hash seeded (Rust) |
| Sports/Events | Live | Maximizer + standard |

## Wallet Support

- KasWare browser extension
- BIP39 mnemonic import
- Player 1 (house) + Player 2 (bettor) pre-loaded for testing
- Resolver-only RPC (Borsh encoding)

## Protocol Fees

| Scenario | User Receives | Protocol Fee |
|----------|---------------|--------------|
| Skill win (100 KAS pot) | 98 KAS | 2 KAS |
| Event win std (100 KAS @ 1.5x) | 148 KAS | 1 KAS (on net) |
| Event win max (100 KAS @ 1.5x) | 294 KAS | 6 KAS (on gross) |
| Hedge claim (50 KAS hedge) | 35 KAS | 15 KAS |
| Cancel pre-join | 100% refund | 0 |
| Deadline expiry | 50/50 refund | 0 |

## Fee Addresses (hardcoded in covenant scripts)

- **Mainnet:** `kaspa:qza6ah0lfqf33c9m00ynkfeettuleluvnpyvmssm5pzz7llwy2ka5nkka4fel`
- **TN12:** `kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m`

## Architecture

```
Frontend (index.html + flat JS)
  |
  +-- WASM (htp-rust-backend/pkg/)
  |     +-- covenant_escrow.rs
  |     +-- fee_engine.rs
  |     +-- autopayout.rs
  |     +-- board_engine.rs
  |     +-- backgammon.rs, rps.rs, coinflip.rs, wordduel.rs
  |
  +-- Oracle Daemon (htp-oracle-daemon/)
  |     +-- Deterministic signing
  |     +-- M-of-N attestor scaffold
  |
  +-- Firebase Bridge (temporary Phase 1)
  |     +-- RTDB for game state coordination
  |     +-- Every record anchored: covenant_id + tx_hash + block_daa
  |
  +-- Kaspa TN12 (L1)
        +-- Resolver-only RPC
        +-- Borsh encoding
        +-- KIP-17 / KIP-20 covenants
```

## SilverScript Contracts

See `contracts/` directory:
- `skill_game_escrow.silverscript`
- `maximizer_escrow.silverscript`
- `event_escrow.silverscript`
- `hedge_escrow.silverscript`
- `commit_reveal.silverscript`

## Roadmap

| Phase | Date | Milestone |
|-------|------|-----------|
| 1 | Now (TN12) | KIP-17 custody, KIP-20 IDs, Firebase bridge, on-chain anchors |
| 2 | Jun 2026 Mainnet | M-of-N attestors, covenant state hashes, KIP-16 Groth16 proofs |
| 3 | vprogs | Synchronous on-chain state, Firebase removed, frontend = L1 read |

## Development

```bash
# Serve locally (port 8765 — NEVER 3000)
serve . -l 8765

# Build Rust WASM
cd htp-rust-backend
wasm-pack build --target web --out-dir ../pkg

# Run tests
cd htp-rust-backend && cargo test
```

## License

MIT

---
*High Table Protocol v6 — Toccata-native, Rust-first, fully trustless.*
