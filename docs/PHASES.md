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

### Concrete June 2026 Mainnet Checklist

- [ ] **Attestor Onboarding (#4)**
  - [ ] Attestor registration and key generation ceremony
  - [ ] Multi-sig wallet setup with M-of-N threshold configuration
  - [ ] Attestor dashboard and monitoring tools
  - [ ] Backup and recovery procedures documentation

- [ ] **Threshold Key Ceremony**
  - [ ] M-of-N threshold signature implementation (multisig.rs stub ✅)
  - [ ] Distributed key generation ceremony
  - [ ] Key rotation and recovery mechanisms
  - [ ] Threshold signing protocol testing

- [ ] **Covenant Hash Anchoring**
  - [ ] On-chain covenant state hash recording
  - [ ] State verification against Firebase bridge
  - [ ] Hash aggregation and anchoring to mainnet blocks
  - [ ] State transition validation

- [ ] **Groth16 Proof Verification**
  - [ ] ZK circuit design for oracle outcomes
  - [ ] Proof generation infrastructure
  - [ ] On-chain proof verification (zk_pipeline.rs ready)
  - [ ] Integration with covenant spend paths

- [ ] **Mainnet RPC Endpoint Migration**
  - [ ] Production RPC endpoint configuration
  - [ ] Load balancing and failover setup
  - [ ] Transaction propagation monitoring
  - [ ] RPC rate limiting and security

- [ ] **Fee Engine Audit**
  - [ ] Comprehensive fee calculation testing
  - [ ] Edge case handling verification
  - [ ] Performance benchmarking
  - [ ] Documentation and deployment guide

- [ ] **Security Re-audit**
  - [ ] Full codebase security review
  - [ ] M-of-N threshold signing security analysis
  - [ ] Covenant escrow vulnerability assessment
  - [ ] Penetration testing and threat modeling

- [ ] **Frontend WASM-only Fee Calculation**
  - [ ] Complete WASM migration for fee calculations
  - [ ] Browser-side fee validation
  - [ ] Fallback mechanisms for fee calculation
  - [ ] User experience testing

- [ ] **Public Beta Launch**
  - [ ] Beta testing program launch
  - [ ] User feedback collection and iteration
  - [ ] Performance monitoring and optimization
  - [ ] Bug tracking and resolution process

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
