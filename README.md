# HTP Antigravity — Fix & Implementation Package

Structured fixes and new features for **High Table Protocol** (hightable420.web.app).

## Structure

```
antigravity/
├── src/                        # Drop-in replacements for /27 project root
│   ├── htp-utxo-mutex.js       # P0 — UTXO double-spend guard
│   ├── htp-board-engine-fix.js # P0 — Chess API normaliser + clock fix
│   └── htp-chess-ui.js         # P1 — Piece colouring + promotion modal
├── oracle/                     # Run from htp-oracle-daemon/
│   ├── watcher.js              # P0 — Fixed settlement watcher v2.1
│   ├── package.json
│   └── .env.example
├── functions/                  # Firebase Cloud Functions (requires Blaze)
│   ├── htp-oracle-server.js    # P1 — Oracle + move validator
│   ├── test-oracle.js          # 10 tests — run before deploying
│   └── package.json
├── patch-index.py              # Injects src/ scripts into index.html
├── deploy.sh                   # Lint → test → deploy pipeline
└── README.md
```

## Quick Start (P0 — do this when Firebase is back up)

### 1. Copy src/ files to your /27 project root
```bash
cp src/htp-utxo-mutex.js    /mnt/c/Users/User/Desktop/27/
cp src/htp-board-engine-fix.js /mnt/c/Users/User/Desktop/27/
cp src/htp-chess-ui.js      /mnt/c/Users/User/Desktop/27/
```

### 2. Patch index.html (injects scripts in correct order)
```bash
cd /mnt/c/Users/User/Desktop/27
python3 /path/to/antigravity/patch-index.py
```

### 3. Fix the Oracle daemon
```bash
cp oracle/watcher.js /mnt/c/Users/User/Desktop/27/htp-oracle-daemon/watcher.js
cd /mnt/c/Users/User/Desktop/27/htp-oracle-daemon
# Edit .env — set FIREBASE_DB_URL
node watcher.js   # should print "HTP Settlement Watcher v2.1 starting..."
```

### 4. Deploy
```bash
cd /mnt/c/Users/User/Desktop/27
bash /path/to/antigravity/deploy.sh hosting
```

## P1 — Firebase Functions (requires Blaze plan)

1. Upgrade project at https://console.firebase.google.com/project/hightable420/usage/details
2. Copy functions/ to your /27 project:
   ```bash
   cp -r functions /mnt/c/Users/User/Desktop/27/
   ```
3. Generate oracle key and store as secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   firebase functions:secrets:set HTP_ORACLE_PRIVKEY
   ```
4. Test and deploy:
   ```bash
   cd /mnt/c/Users/User/Desktop/27
   bash /path/to/antigravity/deploy.sh functions
   ```

## Verify Deployment (browser console should show)
```
[HTP-MUTEX] UTXO mutex loaded
[HTP-MUTEX] htpSendTx serialised — UTXO double-spend guard active
[HTP-FIX]  Board Engine Fix v2.0 loaded
[HTP-UI]   Chess UI v2.0 loaded
```
