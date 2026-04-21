# HTP Protocol Rules — v6

## Money Unit

ALL calculations in **SOMPI** (u64). 1 KAS = 100,000,000 sompi.

Never use floating point for money. FeeEngine returns u64 tuples.

## Fee Formulas (with worked examples)

### 1. Skill Game Win
- **Input:** pot (sum of both stakes)
- **Output:** winner_net, protocol_fee
- **Formula:** fee = pot * 200 / 10,000; winner = pot - fee
- **Example:** pot = 200 KAS = 20,000,000,000 sompi
  - fee = 20,000,000,000 * 200 / 10,000 = 400,000,000 sompi (4 KAS)
  - winner = 20,000,000,000 - 400,000,000 = 19,600,000,000 sompi (196 KAS)

### 2. Event Win (Standard)
- **Input:** stake, odds_num, odds_den
- **Output:** winner_total, protocol_fee
- **Formula:**
  - gross = stake * odds_num / odds_den
  - net_win = gross - stake (if gross > stake else 0)
  - fee = net_win * 200 / 10,000
  - winner_total = gross - fee
- **Example:** stake = 100 KAS, odds = 15/10 (1.5x)
  - gross = 100 * 15 / 10 = 150 KAS
  - net_win = 50 KAS
  - fee = 50 * 200 / 10,000 = 1 KAS
  - winner_total = 149 KAS

### 3. Event Win (Maximizer)
- **Input:** actual_bet = stake * 2 (pool + hedge each = stake)
- **Output:** winner_total, protocol_fee
- **Formula:**
  - gross = actual_bet * odds_num / odds_den
  - fee = gross * 200 / 10,000
  - winner = gross - fee
- **Example:** stake = 100 KAS, maximizer doubles to 200 KAS actual_bet, odds = 15/10
  - gross = 200 * 15 / 10 = 300 KAS
  - fee = 300 * 200 / 10,000 = 6 KAS
  - winner = 294 KAS

### 4. Hedge Claim (Maximizer Loss Protection)
- **Input:** hedge_utxo_amount (typically = stake)
- **Output:** user_refund, protocol_fee
- **Formula:** user = hedge * 7,000 / 10,000; fee = hedge - user
- **Example:** hedge = 50 KAS
  - user = 50 * 7,000 / 10,000 = 35 KAS
  - fee = 15 KAS (30%)

### 5. Cancel (Pre-Join)
- **Formula:** refund = 100% of stake, fee = 0

### 6. Deadline Expiry
- **Formula:** each player = total / 2 (rounded), fee = 0

## Covidant Spend Paths

| Path | Trigger | Enforced By |
|------|---------|-------------|
| Winner | attestor_sig + winner_sig | script (OP_CHECKSIGVERIFY x2) |
| Deadline | block_time > deadline | OP_CHECKBLOCKHEIGHT |
| Cancel | creator_sig (before join) | OP_IF branch |
| Leave | player abandons | opponent auto-wins via timeout |
| Hedge | always available if maximizer | separate hedge UTXO script |

## Maximizer Structure

```
Bet 100 KAS total
├── Pool UTXO: 50 KAS (standard win/lose)
└── Hedge UTXO: 50 KAS (loss protection)
    ├── Win: ignored (winner takes pool+opponent)
    └── Lose: claim hedge = 35 to user, 15 to protocol
```

## Limits

- Maximizer limit_pct scales with expected_volume
- 0% = toggle hidden for event creator
- UI shows live progress bar: used / cap

## Network Fee

- Minimum: 10,000 sompi (0.0001 KAS) per TX
- Always paid first before any other distributions
