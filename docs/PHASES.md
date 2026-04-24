# Decentralisation Roadmap

## Phase 1 (TN12 Toccata — NOW):
- [x] All 9 games live
- [x] Covenant escrow v2
- [x] Oracle daemon
- [x] Firebase bridge
- [x] CI/CD pipeline
- [x] WASM compiled + browser verified (Agent 17)
- [x] UI/UX polish (Agent 10)
- [ ] QA all green (Agent 12)
- [ ] Security review sign-off

## Phase 2 (Mainnet — Target June 2026):
- [ ] KIP-17 covenant audit by external auditor
- [ ] M-of-N attestor network (3-of-5 minimum)
- [ ] ZK proof integration (Groth16 via KIP-16)
- [ ] Decentralized oracle (remove Firebase dependency)
- [ ] Token launch: HTP governance token
- [ ] Mainnet deployment + DNS cutover
- [ ] Bug bounty program live

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
