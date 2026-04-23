# High Table Protocol - Phase 1 End-to-End QA Integration Testing Checklist

## Environment Setup
- **Network**: Kaspa Testnet TN12 only
- **Port**: 8765 (localhost development)
- **Test Mnemonics**: See `qa-mnemonics.md` for Player 1 and Player 2 test wallets
- **Browser**: Chrome/Firefox dev console testing

---

## 1. Wallet Connection Tests

### ✅ Test 1.1: Wallet Connection Flow
- [ ] Navigate to application on `localhost:8765`
- [ ] Click "Connect Wallet" button
- [ ] Test both mnemonic import and KasWare extension options
- [ ] Verify wallet address displays correctly after connection
- [ ] Verify testnet TN12 network selection (NOT mainnet)
- [ ] Check wallet balance displays in KAS units (not sompi)
- [ ] Test wallet disconnection and reconnection

### ✅ Test 1.2: Multiple Wallet Support
- [ ] Connect Player 1 wallet using test mnemonic
- [ ] Connect Player 2 wallet in separate browser/incognito
- [ ] Verify each wallet maintains separate session state
- [ ] Test concurrent wallet operations without interference

---

## 2. Game Creation Tests

### ✅ Test 2.1: Chess Game Creation
- [ ] Click "Create Match" → Chess
- [ ] Set stake amount: 5 KAS (500,000,000 sompi)
- [ ] Set time control: 5 minutes (300 seconds)
- [ ] Verify match appears in lobby with correct details
- [ ] Check creator name displays correctly
- [ ] Verify stake amount shows as KAS (not sompi)

### ✅ Test 2.2: Checkers Game Creation
- [ ] Create Checkers match with 3 KAS stake
- [ ] Verify game-specific UI elements load correctly
- [ ] Test piece movement preview functionality

### ✅ Test 2.3: Connect4 Game Creation
- [ ] Create Connect4 match with 2 KAS stake
- [ ] Verify column drop animation works
- [ ] Test win condition detection

### ✅ Test 2.4: Backgammon Game Creation
- [ ] Create Backgammon match with 10 KAS stake
- [ ] Test dice roll simulation
- [ ] Verify board piece movement

### ✅ Test 2.5: Simple Games Creation
- [ ] Create Rock Paper Scissors match (1 KAS)
- [ ] Create Coinflip match (1 KAS)
- [ ] Create Word Duel match (2 KAS)
- [ ] Create Poker match (5 KAS)
- [ ] Create Blackjack match (3 KAS)

### ✅ Test 2.6: Invalid Creation Tests
- [ ] Try creating match with 0 KAS stake (should fail)
- [ ] Try creating match with decimal stake (should use integer sompi)
- [ ] Try creating match without wallet connected (should prompt connection)

---

## 3. Match Join Flow Tests

### ✅ Test 3.1: Successful Join
- [ ] Player 1 creates Chess match (5 KAS stake)
- [ ] Player 2 clicks "Join" on the match
- [ ] Verify join transaction initiated
- [ ] Check match status updates to "In Progress"
- [ ] Verify both players see game board load

### ✅ Test 3.2: Duplicate Join Prevention
- [ ] Player 1 creates match
- [ ] Player 2 attempts to join same match twice
- [ ] Verify system prevents duplicate joins
- [ ] Check error message displays appropriately
- [ ] Verify no double-spending occurs

### ✅ Test 3.3: Join Timeout
- [ ] Create match with short timeout (30 seconds)
- [ ] Let join window expire without opponent
- [ ] Verify match cancels and refund processed
- [ ] Check creator gets full stake returned

---

## 4. Covenant Escrow Tests

### ✅ Test 4.1: Escrow Creation
- [ ] Join match as Player 2
- [ ] Verify covenant script generates correctly
- [ ] Check both stakes lock in escrow (total = 2 × stake)
- [ ] Verify escrow address is unique per match
- [ ] Test covenant spend path conditions

### ✅ Test 4.2: Spend Path Verification
- [ ] Simulate game completion (win/lose/draw)
- [ ] Verify winner can claim full payout
- [ ] Test draw scenario (split stakes)
- [ ] Verify forfeit handling (winner takes all)
- [ ] Check fee deduction (2% from winner's share)

### ✅ Test 4.3: Cancel Flow
- [ ] Create match as Player 1
- [ ] Cancel before Player 2 joins
- [ ] Verify full refund to creator
- [ ] Check no fees charged for early cancel

---

## 5. Fee Engine u64 Correctness Tests

### ✅ Test 5.1: Integer-Only Operations
- [ ] Verify all KAS amounts use u64 integers
- [ ] Test: 1 KAS = 100,000,000 sompi conversion
- [ ] Check no floating-point math in fee calculations
- [ ] Verify fee calculations:
  - 5 KAS stake → 0.1 KAS fee (100,000,000 sompi)
  - 10 KAS stake → 0.2 KAS fee (200,000,000 sompi)

### ✅ Test 5.2: Maximizer Fee Logic
- [ ] Create event with maximizer option
- [ ] Test 50% hedge, 50% pool contribution
- [ ] Verify 2% fee on winnings for maximizer wins
- [ ] Test 30% fee on hedge for maximizer losses
- [ ] Check 35% net hedge recovery calculation

### ✅ Test 5.3: Treasury Address
- [ ] Verify testnet treasury: `kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m`
- [ ] Check fees route to correct treasury address
- [ ] Verify no mainnet addresses in testnet mode

---

## 6. Oracle Attestation Tests

### ✅ Test 6.1: Deterministic Signing
- [ ] Oracle signs game result deterministically
- [ ] Verify same input produces same signature
- [ ] Test signature validation on-chain
- [ ] Check attestation includes match ID and result

### ✅ Test 6.2: Oracle Timeout
- [ ] Create match with oracle timeout (e.g., 1 hour)
- [ ] Let timeout expire without result
- [ ] Verify refund process triggers
- [ ] Check both players can claim refunds

---

## 7. Firebase Bridge Tests

### ✅ Test 7.1: Timeout Watcher
- [ ] Create match with short timeout
- [ ] Disconnect browser before timeout
- [ ] Verify Firebase watcher detects timeout
- [ ] Check cleanup process initiates
- [ ] Verify state consistency after timeout

### ✅ Test 7.2: Real-time Sync
- [ ] Test game state synchronization
- [ ] Verify move broadcasts to opponent
- [ ] Test disconnect/reconnect handling
- [ ] Check Firebase rules enforcement

---

## 8. Settlement Overlay Tests

### ✅ Test 8.1: Winner Display
- [ ] Complete Chess game with winner
- [ ] Verify settlement overlay shows:
  - Winner name and amount
  - Loser amount (if any)
  - Fee deduction breakdown
  - Net payout amounts

### ✅ Test 8.2: Draw Display
- [ ] Complete game in draw state
- [ ] Verify stake split shown correctly
- [ ] Check fee deductions for both players
- [ ] Test overlay dismissal

---

## 9. Deposit/Withdraw/Pause Tests

### ✅ Test 9.1: Deposit Functionality
- [ ] Test direct KAS deposit to wallet
- [ ] Verify balance updates immediately
- [ ] Check deposit history logging
- [ ] Test minimum deposit amounts

### ✅ Test 9.2: Withdraw Functionality
- [ ] Withdraw KAS from wallet
- [ ] Verify transaction broadcasting
- [ ] Check balance deduction
- [ ] Test withdrawal limits and fees

### ✅ Test 9.3: Pause/Resume
- [ ] Test admin pause functionality
- [ ] Verify new match creation blocked
- [ ] Check existing matches continue
- [ ] Test resume functionality

---

## 10. Error Handling Tests

### ✅ Test 10.1: Insufficient Balance
- [ ] Try creating match with > wallet balance
- [ ] Verify appropriate error message
- [ ] Check no partial transactions occur

### ✅ Test 10.2: Network Errors
- [ ] Disconnect internet mid-transaction
- [ ] Verify graceful error handling
- [ ] Test transaction retry mechanism
- [ ] Check state consistency

### ✅ Test 10.3: Invalid Input
- [ ] Test negative stake amounts
- [ ] Test extremely large stakes
- [ ] Test invalid time controls
- [ ] Verify input validation works

---

## Test Data Requirements

### Test Wallets
- Player 1: Minimum 100 KAS balance
- Player 2: Minimum 50 KAS balance
- Both wallets on testnet TN12

### Test Environment
- Local development server on port 8765
- Firebase emulator or test project
- Oracle service running locally

---

## Success Criteria

✅ **All checklist items must pass** before Phase 1 deployment
✅ **No floating-point arithmetic** in fee calculations  
✅ **u64 integer-only operations** for all KAS amounts
✅ **Testnet TN12 only** - no mainnet transactions
✅ **Port 8765 compliance** for local development

---

## Notes
- Use browser developer console for manual testing
- Test harness available in `qa-test-harness.js` for automation
- Report any issues with specific error messages and reproduction steps
- Document test results with timestamps for audit trail