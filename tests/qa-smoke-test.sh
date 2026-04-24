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
FEE_EXPORTS=$(grep -c "W.HTPFee = {" /home/kasparov/high-table-frontend/htp-fee-engine.js)
FEE_FUNC=$(grep -c "skillGameSettle" /home/kasparov/high-table-frontend/htp-fee-engine.js)
if [[ $FEE_EXPORTS -ge 1 && $FEE_FUNC -ge 1 ]]; then
  check_item "Fee engine exports" "PASS"
else
  check_item "Fee engine exports" "FAIL"
fi

echo
echo "6. Verifying WASM bridge integration..."
WASM_TEST=$(grep -c "window.HTP.feeEngine" /home/kasparov/high-table-frontend/htp-wasm-bridge.js)
if [[ $WASM_TEST -ge 1 ]]; then
  check_item "WASM bridge exports" "PASS"
else
  check_item "WASM bridge exports" "FAIL"
fi

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