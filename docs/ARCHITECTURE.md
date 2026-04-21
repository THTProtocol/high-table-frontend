# HTP Architecture

## System Diagram

```
+-------------------------------------------------------------+
|                    User Browser                           |
|  + index.html (flat, ~1MB, no bundler)                     |
|  + htp-wallet-v3.js (mnemonic + KasWare)                  |
|  + htp-rpc-client.js (Resolver, Borsh)                    |
|  + htp-covenant-escrow-v2.js (JS fallback)               |
|  + htp-maximizer-ui.js / htp-event-creator.js            |
|  + Game UIs: chess-ui.js, backgammon-ui.js, rps-ui.js... |
+-------------------------------------------------------------+
                             |
                             v
+-------------------------------------------------------------+
|                    WASM Layer (pkg/)                        |
|  + covenant_escrow.rs    -- KIP-17/KIP-20 covenants        |
|  + fee_engine.rs         -- u64 SOMPI calculations        |
|  + autopayout.rs         -- TX construction              |
|  + board_engine.rs       -- Game validation              |
|  + backgammon.rs, rps.rs, coinflip.rs, wordduel.rs       |
+-------------------------------------------------------------+
                             |
           +-----------------+----------------+
           |                                  |
           v                                  v
+------------------------+      +----------------------------+
|  Firebase Bridge       |      |  Kaspa TN12 L1             |
|  (temporary Phase 1)   |      |  Resolver-only RPC         |
|  - RTDB game state     |      |  - Borsh encoding           |
|  - 60s timeout         |      |  - KIP-17 opcodes           |
|  - covenant anchors     |      |  - KIP-20 covenant IDs      |
+------------------------+      |  - 1s blocks                |
                                +----------------------------+
                                           |
                                +----------------------------+
                                |  Oracle Daemon             |
                                |  - htp-oracle-daemon/      |
                                |  - Deterministic signing   |
                                |  - M-of-N attestor scaffold|
                                |  - GitHub Actions cron     |
                                +----------------------------+
```

## Data Flow: Skill Game

1. P1 creates game -> Rust WASM generates covenant escrow -> returns covenant_id + P2SH address
2. P1 deposits stake to P2SH address
3. P2 joins -> deposits stake to same P2SH address
4. Game plays (state synced via Firebase for UI, anchored on L1)
5. Winner determined -> oracle daemon gets result -> deterministic sign
6. Settlement TX built in Rust WASM -> signed by winner + attestor
7. TX broadcast via resolver-only RPC
8. Winner receives 98%, protocol receives 2%

## Data Flow: Maximizer Event

1. Creator sets expected_volume + maximizer_limit_pct
2. Bettor selects Standard or Maximizer in bet modal
3. Maximizer = 50% pool + 50% hedge UTXO
4. Win: (stake*2) * odds * 0.98
5. Lose: hedge claim = 50 * 0.70 to user, 50 * 0.30 to protocol

## Security Boundaries

| Boundary | Trust Model |
|----------|-------------|
| Covenant script | Trustless (enforced by L1) |
| Rust fee engine | Trustless (compiled, verified) |
| Oracle daemon | Semi-trusted (M-of-N makes trustless in Phase 2) |
| Firebase bridge | Trusted coordinator (removed in Phase 3) |
| Frontend UI | Trusted display (covenants enforce actual behavior) |