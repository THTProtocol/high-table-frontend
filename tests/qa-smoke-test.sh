#!/bin/bash

echo "=== HTP QA Smoke Test ==="
echo "Date: $(date)"
echo "Server: localhost:8765"
echo

PASS_COUNT=0
FAIL_COUNT=0
check_item() {
  local name="$1"
  local result="$2"
  if [[ "$result" == "PASS" ]]; then
    echo "✅ $name: PASS"
    ((PASS_COUNT++))
  else
    echo "❌ $name: FAIL"
    ((FAIL_COUNT++))
  fi
}

echo "1. Testing server response..."
SERVER_RESP=$(curl -s localhost:8765 2>/dev/null)
if echo "$SERVER_RESP" | grep -qi "high table\|HTP"; then
  check_item "Server running" "PASS"
else
  check_item "Server running" "FAIL"
fi

echo
echo "2. Checking core JS files..."
CORE_FILES=(
  "htp-fee-engine.js"
  "htp-oracle-sync.js" 
  "htp-covenant-escrow-v2.js"
  "htp-firebase-bridge.js"
  "htp-wallet-v3.js"
)

for file in "${CORE_FILES[@]}"; do
  if [[ -f "/home/kasparov/high-table-frontend/$file" ]]; then
    check_item "Core file: $file" "PASS"
  else
    check_item "Core file: $file" "FAIL"
  fi
done

echo
echo "3. Checking game UI files..."
GAME_FILES=(
  "htp-chess-ui.js"
  "htp-checkers-multijump.js"
  "htp-c4-animation.js"
  "htp-backgammon-ui.js"
  "htp-rps-ui.js"
  "htp-coinflip-ui.js"
  "htp-wordduel-ui.js"
  "htp-poker-ui.js"
  "htp-blackjack-ui.js"
)

for file in "${GAME_FILES[@]}"; do
  if [[ -f "/home/kasparov/high-table-frontend/$file" ]]; then
    check_item "Game UI: $file" "PASS"
  else
    check_item "Game UI: $file" "FAIL"
  fi
done

echo
echo "4. Checking WASM bridge..."
if [[ -f "/home/kasparov/high-table-frontend/pkg/htp_rust_backend_bg.wasm" ]]; then
  check_item "WASM file exists" "PASS"
else
  check_item "WASM file exists" "FAIL"
fi

echo
echo "5. Verifying fee engine exports..."
FEE_TEST=$(node -e "
const fs = require('fs');
const content = fs.readFileSync('/home/kasparov/high-table-frontend/htp-fee-engine.js', 'utf8');
if (content.includes('window.HTPFee') && content.includes('skillGameSettle')) {
  console.log('PASS');
} else {
  console.log('FAIL');
}
" 2>/dev/null)

check_item "Fee engine exports" "$FEE_TEST"

echo
echo "6. Verifying fee engine WASM bridge test..."
FEE_WASM_TEST=$(node -e "
// Mock window object and test fee calculation
const window = { HTPFee: null };
const fs = require('fs');
eval(fs.readFileSync('/home/kasparov/high-table-frontend/htp-fee-engine.js', 'utf8').replace(/window\./g, 'window.'));
if (window.HTPFee && typeof window.HTPFee.skillGameSettle === 'function') {
  try {
    const result = window.HTPFee.skillGameSettle(100000000n); // 1 KAS in sompi
    if (result.winner === 98000000n && result.fee === 2000000n) {
      console.log('PASS');
    } else {
      console.log('FAIL');
    }
  } catch (e) {
    console.log('FAIL');
  }
} else {
  console.log('FAIL');
}
" 2>/dev/null)

check_item "Fee engine WASM integration" "$FEE_WASM_TEST"

echo
echo "=== SMOKE TEST SUMMARY ==="
echo "✅ Passed: $PASS_COUNT"
echo "❌ Failed: $FAIL_COUNT"
echo

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo "🎉 ALL SMOKE TESTS PASSED"
  exit 0
else
  echo "⚠️  Some smoke tests failed"
  exit 1
fi