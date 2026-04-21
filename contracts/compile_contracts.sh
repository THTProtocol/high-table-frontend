#!/bin/bash

# SilverScript Contract Compilation Script
# Tests compilation of all High Table Protocol contracts

echo "Compiling SilverScript Contracts for High Table Protocol..."
echo "=========================================================="

# Check if silverc is available
if ! command -v silverc &> /dev/null; then
    echo "⚠️  silverc not found in PATH"
    echo "   Install from: /home/kasparov/silverscript/"
    echo "   Build with: cd /home/kasparov/silverscript && cargo build --release"
    echo "   Add to PATH: export PATH=\$PATH:/home/kasparov/silverscript/target/release"
    exit 1
fi

CONTRACTS=(
    "skill_game_escrow.silverscript"
    "maximizer_escrow.silverscript"
    "event_escrow.silverscript"
    "hedge_escrow.silverscript"
    "commit_reveal.silverscript"
)

echo "Found contracts in $(pwd):"
ls -la *.silverscript

echo ""
echo "Compiling contracts..."

for contract in "${CONTRACTS[@]}"; do
    echo "🔨 Compiling: $contract"
    if silverc "$contract" -o "${contract%.silverscript}.json"; then
        echo "✅ Successfully compiled: $contract"
        ls -lah "${contract%.silverscript}.json"
    else
        echo "❌ Failed to compile: $contract"
        exit 1
    fi
done

echo ""
echo "✅ All contracts compiled successfully!"
echo ""
echo "Contract Summary:"
echo "=================="
echo "1. skill_game_escrow - Winner-takes-all skill games, 2% fee"
echo "2. maximizer_escrow - Two-UTXO design (pool + hedge), 50/50 split"
echo "3. event_escrow - Standard event betting with odds, 2% win fee"
echo "4. hedge_escrow - Hedge UTXO for maximizer with 70/30 loss claim"
echo "5. commit_reveal - RPS/coinflip commit-reveal with salt>=32 bytes"
echo ""
echo "🚀 High Table Protocol contracts ready for deployment!"