# Decentralisation Roadmap

## Phase 1: Now (TN12, April 2026)

- KIP-17 custody opcodes live
- KIP-20 covenant IDs with lineage tracking
- Firebase bridge for game-state coordination (temporary)
- On-chain anchors: every escrow record = covenant_id + tx_hash + block_daa_score
- 1 attestation oracle (N=1, M=1)
- Rust WASM fee engine + covenant escrow

**Design Rule:** Never ship code that blocks Phase 2/3.

## Phase 2: Mainnet (June 2026)

- M-of-N attestors (threshold signing)
- Covenant state hashes on-chain (no Firebase dependency for settlement)
- KIP-16 Groth16 proofs for oracle outcomes
- Multi-sig treasury management
- Full Rust backend (no JS fee calculation)

## Phase 3: vprogs (Late 2026)

- Synchronous on-chain state (KIP-21 partitioned sequencing)
- Firebase removed entirely
- Frontend = L1 read + WASM execution
- ZK proofs for game state transitions
- Fully autonomous protocol (no off-chain components)

## Transition Checklist

| to Phase 2 | Blockers |
|------------|---------|
| M-of-N working | multi_sig.rs complete |
| Covenant state hash | zk_pipeline.rs complete |
| Attestor key rotation | attestor/ module complete |

| to Phase 3 | Blockers |
|-----------|---------|
| On-chain lobby | KIP-21 sequencing |
| No Firebase | board_engine.rs generates proofs |
