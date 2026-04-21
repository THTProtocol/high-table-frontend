# High Table Protocol - SilverScript Contracts

This directory contains 5 SilverScript covenant contracts for the High Table Protocol gaming system.

## Contract Overview

### 1. `skill_game_escrow.silverscript` - Skill Game Escrow
- **Purpose**: Winner-takes-all skill game escrow
- **Fee**: 2% protocol fee on total pool
- **Features**:
  - Pre-join cancel = full refund
  - Post-join leave = auto-loss for forfeiting player
  - Deadline-based emergency refund
  - KIP-20 covenant ID tracking

### 2. `maximizer_escrow.silverscript` - Maximizer Escrow
- **Purpose**: Two-UTXO design (main pool + hedge protection)
- **Allocation**: 50/50 split between pool and hedge
- **Features**:
  - Win claim: 100% payout from main pool
  - Loss protection: User gets 70% from hedge pool
  - Emergency refund after grace period
  - Hedge protection coordination

### 3. `event_escrow.silverscript` - Event Betting Escrow
- **Purpose**: Standard event betting with odds-based payouts
- **Fee**: 2% fee on net winnings only (not stake)
- **Features**:
  - Supports any odds ratio (calculated as numerator/denominator)
  - Bet cancellation before outcomes determined
  - Deadline refunds if no valid outcome published
  - Event organizer cancellation support

### 4. `hedge_escrow.silverscript` - Hedge Protection Escrow
- **Purpose**: Dedicated hedge UTXO for maximizer contracts
- **Claim split**: 30% protocol, 70% user on qualifying loss
- **Features**:
  - Activation block-based timeline
  - Multiple claim windows (protection, maturity, emergency)
  - User cancellation before activation
  - Protocol/admin-controlled cleanup paths

### 5. `commit_reveal.silverscript` - Commit-Reveal Pattern
- **Purpose**: Secure RPS and coinflip games with front-running protection
- **Requirement**: Salt must be >= 32 bytes
- **Features**:
  - Hash-based commit phase (blake2b(move + salt))
  - Reveal phase with move verification
  - Forfeit by non-reveal penalties
  - Mutual cancellation refunds
  - Protocol cleanup for dormant funds

## Protocol Fee Addresses

The contracts hardcode protocol fee addresses to ensure transparency:

```javascript
// Mainnet
kaspa:qza6ah0lfqf33c9m00ynkfeettuleluvnpyvmssm5pzz7llwy2ka5nkka4fel

// TN12 (Testnet)
kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m
```

## KIP-20 Covenant Tracking

All contracts include:
- Written as `bytes32 covenantId` parameter
- Derived via BLAKE2b hash of contract bytecode
- Used for covenant propagation and state tracking
- Enables UTXO-reuse patterns across the protocol

## Usage

### Compilation
```bash
./compile_contracts.sh
```

This compiles all `.silverscript` files to `.json` artifacts containing:
- Bytecode output
- ABI information
- Contract metadata

### Deployment
Contracts take constructor parameters including covenant IDs that must be pre-calculated from the compiled bytecode hash.

## Testing

Each contract includes comprehensive validation:
- Deadline enforcement with configurable windows
- Cryptographic signature verification
- State transitions and access control
- Emergency refund mechanisms
- Protocol fee enforcement

## KIP-17 Compatibility

All contracts use KIP-17 opcodes:
- `blake2b()` cryptographic hashing
- `tx.inputs`/`tx.outputs` introspection
- `new LockingBytecodeP2PK()` covenant creation
- `checkSig()` signature verification
- Time-based conditions (`tx.time`, `deadline`)

## Winnings Calculation

### Skill Games
- 2% fee on total pool amount

### Maximizer
- Wins: 100% of main pool
- Losses: 70% of hedge pool (30% to protocol)

### Event Betting
- 2% fee on net winnings only (not original stake)
- Odds calculated as: payout = stake * (numerator / denominator)

### Commit-Reveal
- 2% fee on total game amount
- Draw: Funds split equally between players

All calculations use integer division with proper rounding.

## Security Features

- Minimum bet validation (1 KAS minimum)
- Salt length requirements (32+ bytes)
- Deadline grace periods for each phase
- Multi-signature requirement for critical operations
- Emergency refund mechanisms as final resort