# High Table Protocol
## A Trustless Skill-Gaming and Prediction Market Infrastructure on Kaspa

**Version 1.0 | April 2026**

---

## Abstract

High Table Protocol (HTP) is a non-custodial, trustless gaming and prediction market infrastructure built natively on the Kaspa blockDAG. The protocol enables two or more parties to compete in verifiable skill-based games or take positions in binary prediction markets, with funds locked on-chain and payouts executed automatically upon outcome resolution. No platform holds user funds at any point. No KYC is required. No intermediary can interfere with, delay, or redirect a payout. Funds flow directly from the on-chain escrow to the winner's wallet.

HTP operates in three successive architectural phases, each unlocking a higher degree of cryptographic trustlessness as Kaspa's protocol capabilities mature. The current implementation operates on Kaspa Testnet TN12. Production deployment targets the Kaspa mainnet following the Q2 2026 hard fork activating covenant opcodes (KIP-17).

---

## 1. Introduction

### 1.1 The Problem with Custodial Skill Platforms

Every existing online skill-gaming and betting platform operates on a custodial model. Users deposit funds into a platform-controlled wallet. The platform holds those funds, executes payouts at its discretion, and retains the ability to freeze, delay, or confiscate balances at any time. This model introduces several structural failure modes:

- **Counterparty risk.** Platform insolvency, regulatory seizure, or fraud results in total user loss.
- **Censorship.** Platforms can block users, restrict withdrawals, or void outcomes retroactively.
- **Opacity.** Payout logic is a black box. Users cannot verify that rules were applied correctly.
- **Geographic exclusion.** KYC and banking restrictions exclude billions of potential participants.

The only complete solution to these problems is to remove the custodian entirely. If funds are locked in a smart contract or covenant script that neither party nor any platform can unilaterally access, the trust model collapses to pure cryptography.

### 1.2 Why Kaspa

Kaspa is uniquely positioned as the base layer for trustless gaming infrastructure for three reasons.

**Throughput and finality.** Kaspa's GHOSTDAG-based blockDAG achieves one block per second with near-instant probabilistic finality. A user submitting an escrow transaction can expect it to be confirmed within seconds, not minutes. This is essential for interactive real-time gameplay where escrow confirmation must precede the first move.

**UTXO model.** Kaspa uses a UTXO-based transaction model analogous to Bitcoin. UTXOs are discrete, auditable, and do not require account state management. An escrow UTXO is a verifiable on-chain object that cannot be modified or double-spent without a valid signature satisfying the locking script.

**Covenant opcodes (KIP-17).** The Q2 2026 hard fork introduces transaction introspection opcodes including `OP_INPUTSPK`, enabling covenant-constrained scripts. A covenant can enforce that a spending transaction sends outputs only to a pre-specified set of addresses, which in HTP's case are the two player pubkeys registered at match creation. This eliminates oracle dependency for payout routing entirely.

**ZK proof verification (KIP-16).** KIP-16 introduces on-chain verification of zero-knowledge proofs. Once active, a game outcome can be cryptographically proven without revealing the full move sequence, and the proof itself can gate covenant spending. This makes game result verification fully trustless and fully private.

---

## 2. Protocol Architecture

HTP is organized into three functional layers:

```
Layer 3: Application Layer
         Games (Chess, Connect 4, Checkers)
         Prediction Markets
         Match Lobby and Series Management

Layer 2: Settlement Layer
         Outcome Oracle
         Auto-Payout Engine
         UTXO Mutex

Layer 1: Escrow Layer
         Covenant Escrow Contract
         P2SH Address Construction
         Transaction Broadcast via Kaspa WASM SDK
```

Each layer has a clean dependency boundary. The application layer knows nothing about transaction construction. The settlement layer knows nothing about game rules. The escrow layer knows nothing about who won. This separation means each layer can be upgraded independently as Kaspa's capabilities evolve.

---

## 3. Escrow Layer

### 3.1 Phase 1: P2SH Escrow (Current, TN12)

In Phase 1, escrow addresses are constructed as Pay-to-Script-Hash addresses encoding a 2-of-2 multisignature requirement between the two player pubkeys. The escrow UTXO can only be spent by a transaction signed by both players, or by the oracle when it has confirmed an outcome.

The escrow address construction follows:

```
scriptPubKey  = OP_2 <pubkeyA> <pubkeyB> OP_2 OP_CHECKMULTISIG
escrowAddress = P2SH(HASH160(scriptPubKey))
```

The match creation flow proceeds as follows:

```
1. Player A selects game type, escrow amount, time control, and series length
2. Protocol constructs escrowAddress from pubkeyA and pubkeyB
3. Player A broadcasts a transaction sending escrowAmount KAS to escrowAddress
4. Oracle daemon polls Kaspa TN12 for UTXOs at escrowAddress
5. After 10 confirmations, oracle writes escrow_confirmed: true to match state
6. Player B is notified and the match begins
```

The payout formula for a completed match is:

```
pot              = escrowAmount * 2
protocol_fee     = pot * 0.02
winner_payout    = pot - protocol_fee
draw_payout      = (pot - protocol_fee) / 2   (per player, on draw)
```

The UTXO mutex prevents race conditions during payout construction. Before any payout transaction is assembled, the engine acquires a distributed lock on the UTXO reference. If two processes attempt to spend the same UTXO simultaneously, the second will find the lock already held and abort.

### 3.2 Phase 2: Covenant-Native Escrow (Post-KIP-17, Q2 2026)

KIP-17 introduces `OP_INPUTSPK` and related introspection opcodes. In Phase 2, the escrow locking script is replaced by a covenant script that enforces output routing at the consensus layer:

```
// Covenant script (SilverScript notation)
OP_INPUTSPK          // push the scriptPubKey of the input being spent
OP_1 OP_PICK         // bring the first output scriptPubKey onto the stack
OP_EQUALVERIFY       // verify it matches pubkeyA or pubkeyB
OP_CHECKSIG          // verify winner's signature
```

With this construction, the spending transaction is valid only if it pays to one of the two original player pubkeys. The oracle no longer routes funds; it only attests to the outcome. The funds route themselves. No off-chain service can misdirect a payout.

### 3.3 Phase 3: ZK-Verified Escrow (Post KIP-16)

KIP-16 enables on-chain verification of succinct zero-knowledge proofs. In Phase 3, the game engine generates a proof of correct execution:

```
proof = ZK_PROVE(
  statement:  "given initial board state S_0 and move sequence M,
               the final board state S_n is a win for pubkeyA",
  witness:    M  (the full move sequence, kept private)
)
```

The covenant script verifies this proof inline:

```
OP_ZK_VERIFY(proof, statement)   // fails if proof is invalid
OP_CHECKSIG                      // winner signs the spending tx
```

This construction removes the oracle from outcome verification entirely. The winner proves to consensus that they won, without revealing how. The covenant releases funds upon valid proof submission. The system is fully trustless and fully private.

---

## 4. Settlement Layer

### 4.1 Outcome Oracle

The oracle is a lightweight daemon that performs two functions: escrow confirmation and outcome attestation.

**Escrow confirmation** is fully on-chain. The daemon subscribes to the Kaspa node via WebSocket and watches for UTXOs at the pre-computed escrow address. Upon detecting 10 confirmations, it writes a signed attestation to the match state.

**Outcome attestation** in Phase 1 relies on the game sync state. The daemon reads the final game state and constructs a payout transaction to the winner's registered address. In Phase 2, outcome attestation is reduced to signing a challenge-response with the winner's wallet key, proving address ownership before the covenant releases funds.

The oracle trust model evolves across phases:

| Phase | Outcome Verification | Payout Routing | Trust Requirement |
|-------|---------------------|----------------|-------------------|
| 1 (P2SH) | Oracle reads game state | Oracle signs payout tx | Oracle + coordination layer |
| 2 (KIP-17) | Oracle attests winner | Covenant enforces routing | Oracle only |
| 3 (KIP-16) | ZK proof verified on-chain | Covenant enforces routing | None |

### 4.2 UTXO Mutex

The UTXO mutex is a distributed locking mechanism that prevents double-spend attempts during concurrent payout construction. The algorithm:

```
function acquireLock(utxoId):
  lockRef = db.ref("locks/" + utxoId)
  txn = lockRef.transaction(current => {
    if (current && current.locked) return        // abort: already locked
    return { locked: true, timestamp: Date.now(), holder: nodeId }
  })
  return txn.committed

function releaseLock(utxoId):
  lockRef = db.ref("locks/" + utxoId)
  lockRef.remove()
```

Any payout attempt that fails to acquire the lock is discarded. The lock is automatically released after a 30-second timeout to handle crashed payout processes.

### 4.3 Auto-Payout Engine

The payout engine listens for match state transitions. When a match document transitions to `status: "completed"` with a populated `winner` field, the engine executes the following sequence:

```
1. Acquire UTXO mutex lock
2. Verify escrow_confirmed: true on the match document
3. Read lockedUtxoId and escrowAmount from match document
4. Fetch UTXO from Kaspa node and verify it is unspent
5. Compute winner_payout = escrowAmount * 2 * 0.98
6. Construct payout transaction:
     inputs:  [lockedUtxoId]
     outputs: [{ address: winnerAddress, amount: winner_payout },
               { address: treasuryAddress, amount: protocol_fee }]
7. Sign and broadcast transaction
8. Write txHash to match document
9. Release UTXO mutex lock
```

For draws, the output set is:

```
draw_amount = (escrowAmount * 2 * 0.98) / 2
outputs: [{ address: playerA,  amount: draw_amount },
          { address: playerB,  amount: draw_amount },
          { address: treasury, amount: protocol_fee }]
```

---

## 5. Application Layer

### 5.1 Match Lifecycle

Every match follows a deterministic state machine:

```
PENDING_CHALLENGE
      |
      v  (Player A submits escrow tx)
ESCROW_BROADCAST
      |
      v  (10 block confirmations)
ESCROW_CONFIRMED
      |
      v  (Player B joins and accepts)
IN_PROGRESS
      |
   [game plays out]
      |
      v  (win / draw / timeout / resignation)
RESULT_SUBMITTED
      |
      v  (oracle attests)
PAYOUT_BROADCAST
      |
      v  (tx confirmed)
COMPLETED
```

Cancellation is possible only in the `PENDING_CHALLENGE` state, before an opponent joins. A refund transaction returns the escrowed amount minus transaction fees to Player A.

### 5.2 Series Logic

For Best-of-N series, the series completes when one player reaches a majority:

```
series_complete = (winsA >= ceil(N/2)) OR (winsB >= ceil(N/2))
```

Color and side assignments are determined once at match creation using a cryptographic coin-flip seeded by the transaction hash of the escrow UTXO:

```
seed     = HASH(escrowTxId + matchId)
coinFlip = seed[0] % 2
playerWhite = (coinFlip === 0) ? playerA : playerB
```

In subsequent games of a series, colors alternate from the previous game assignment.

### 5.3 Game Modules

**Chess.** Move validation, check detection, checkmate, stalemate, and draw-by-repetition are handled by a standard chess rules engine. Game state is transmitted between clients as FEN strings after every move. Both clocks are synchronized through the shared match document, with server timestamps used as the authoritative reference for time deltas.

**Connect 4.** A 7-column by 6-row grid with gravity-enforced piece placement. Win detection checks all four orientations (horizontal, vertical, diagonal-left, diagonal-right) after each move. A full board with no four-in-a-row triggers a draw. Column selection is broadcast immediately and reflected on the opponent's board.

**Checkers.** An 8x8 board with piece placement on dark squares only. Standard forced-capture rules apply. King promotion occurs on back-rank entry. Multi-jump chain sequences are fully supported: after a capture, if the capturing piece can make additional captures from its new position, the turn continues until no further captures are available.

### 5.4 Time Controls

Time controls are stored per-match as:

```json
{
  "minutes": N,
  "increment": I
}
```

Each player begins with N minutes. After completing a move, the player gains I seconds. If a player's clock reaches zero, the match resolves in favor of the opponent and the payout flow triggers immediately. Clock state is maintained with server-side `serverTimestamp()` references to prevent client-side manipulation.

### 5.5 Event Predictions

The event prediction module enables binary outcome markets. An event creator defines a title, description, resolution condition, and deadline. Participants take positions by locking KAS into the event escrow. At resolution, the oracle attests to the outcome and the winning side receives proportional shares of the full pool:

```
pool          = sum of all position sizes across both sides
winner_share  = (position_i / total_winning_side) * (pool * 0.98)
```

---

## 6. Security Model

### 6.1 Threat Analysis

| Threat | Phase 1 Mitigation | Phase 2 Mitigation | Phase 3 Mitigation |
|--------|-------------------|-------------------|-------------------|
| Oracle misdirects payout | Oracle key security + ACL | Covenant enforces routing | Not applicable |
| Coordination layer manipulation | Read-only client rules, oracle signs attestation | Covenant enforces routing | ZK proof required |
| Double-spend on payout UTXO | UTXO mutex + node-side UTXO verification | Same | Same |
| Clock manipulation | Server timestamp deltas | Same | Same |
| Colluding players | Escrow only releases on valid outcome | Same | ZK proof prevents result falsification |
| Oracle downtime | Match deadline timeout triggers refund | Same | Proof submission is permissionless |

### 6.2 The Coordination Layer as a Transitional Dependency

The real-time coordination backend serves as the synchronization layer in Phase 1. It is explicitly a transitional dependency, not a permanent architecture choice. The trust assumptions it introduces are bounded: it can observe game state and match metadata, but it cannot move funds. The on-chain UTXO is the only object that matters for custody. Coordination layer corruption can disrupt gameplay synchronization but cannot steal escrowed funds, because the payout transaction requires a valid signature from the oracle key, which operates independently.

The migration path:

- **Phase 2:** Covenant scripts enforce payout routing on-chain. Coordination layer compromise can only disrupt game state, not redirect funds.
- **Long-term:** Replace the coordination backend with a peer-to-peer state channel between the two players, with all state transitions signed by both parties. The oracle only needs to verify the final signed state.

---

## 7. Fee Structure

| Scenario | Fee | Recipient |
|---------|-----|-----------|
| Match win | 2% of pot | Protocol treasury |
| Draw | 2% of pot | Protocol treasury |
| Match cancel (pre-opponent) | Network tx fee only | Miners |
| Event prediction win | 2% of pool | Protocol treasury |

Treasury funds are used for protocol development, oracle infrastructure, and security audits. Fee parameters are defined in the escrow configuration and are verifiable on-chain by inspecting the output set of any payout transaction.

---

## 8. Roadmap

### Phase 1: Testnet (Current)

The protocol is live on Kaspa Testnet TN12. All three game modules (Chess, Connect 4, Checkers) are functional. Escrow locking and payout flow are operational. The oracle daemon is running.

Remaining Phase 1 work:
- Server-side clock validation using server timestamps
- Winner address challenge-response signing to eliminate trust in payout address routing
- Chess drag-and-drop piece movement
- Connect 4 disc-drop animation
- Draw offer and resignation flows wired to escrow split

### Phase 2: Covenant-Native (Post Q2 2026 Hard Fork)

Following the Kaspa mainnet activation of KIP-17, HTP will migrate to covenant-enforced payout routing. The escrow locking script will be rewritten to use `OP_INPUTSPK` and related introspection opcodes. This eliminates the oracle's role in payout routing entirely. The oracle is reduced to outcome attestation only.

Additional Phase 2 deliverables:
- Mainnet deployment
- Mobile-native wallet integration
- On-chain reputation layer using transaction payload attestations
- Prediction market expansion with multi-outcome events

### Phase 3: ZK-Verified Outcomes (Post KIP-16)

Following KIP-16 activation, HTP will integrate zero-knowledge proof generation into the game engine. Each match will produce a compact proof of correct execution that the covenant verifies on-chain before releasing funds. This removes the oracle from outcome verification entirely.

Phase 3 also enables privacy-preserving games where the move sequence is never revealed publicly, only the proof that the outcome was reached correctly.

### Long-Term Vision

HTP's long-term objective is to be the canonical trustless gaming layer for any UTXO blockDAG. The three-layer architecture is chain-agnostic at the application and settlement layers. As Kaspa's ecosystem grows, HTP will expand to additional game types, higher-stakes prediction markets, and cross-platform tournaments with fully on-chain prize pools.

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| UTXO | Unspent Transaction Output. The fundamental unit of value in Kaspa's transaction model. |
| Covenant | A locking script that constrains how a UTXO can be spent, enforced at consensus. |
| P2SH | Pay-to-Script-Hash. A transaction output format that locks funds to the hash of a script. |
| Oracle | An off-chain service that attests to real-world or game outcomes for on-chain use. |
| KIP-17 | Kaspa Improvement Proposal 17. Introduces covenant introspection opcodes including OP_INPUTSPK. |
| KIP-16 | Kaspa Improvement Proposal 16. Introduces on-chain ZK proof verification. |
| FEN | Forsyth-Edwards Notation. A compact string representation of a chess board position. |
| GHOSTDAG | Greedy Heaviest Observed Sub-Tree DAG. Kaspa's consensus protocol enabling parallel block production. |
| TN12 | Kaspa Testnet 12. The current active testnet running covenant-capable node software. |
| ZK Proof | Zero-Knowledge Proof. A cryptographic proof that a statement is true without revealing the witness. |

## Appendix B: Contract Parameters

| Parameter | Value |
|-----------|-------|
| Minimum escrow | 1 KAS |
| Maximum escrow | Uncapped |
| Protocol fee | 2% of pot |
| Oracle confirmation threshold | 10 blocks |
| UTXO mutex timeout | 30 seconds |
| Match timeout | Configurable per time control |
| Cancellation window | Before opponent joins only |

## Appendix C: Technology Stack

| Component | Technology |
|-----------|-----------|
| BlockDAG | Kaspa (TN12 testnet, mainnet post-HF) |
| Smart contracts | SilverScript (Kaspa native covenant language) |
| Client SDK | Kaspa WASM SDK (rusty-kaspa compiled to WebAssembly) |
| Real-time coordination | Firebase Realtime Database (Phase 1 transitional) |
| Game rules engine | chess.js (Chess), custom logic (Connect 4, Checkers) |
| Frontend | Vanilla JS, HTML5, CSS3 |
| Oracle runtime | Node.js |

---

*High Table Protocol is open-source software. The protocol specification, covenant scripts, and game logic are available for public review and community audit.*
