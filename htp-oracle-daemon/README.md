# HTP Oracle Daemon v1.0

Autonomous oracle attestation daemon for the High Table Protocol.
Polls external APIs, signs results with your oracle wallet, writes attestations
to Firebase, and auto-resolves events when threshold is reached.

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your mnemonic and Firebase service key
node oracle-daemon.js
```

## Firebase Service Key

1. Go to: Firebase Console → Project Settings → Service Accounts
2. Click "Generate new private key"
3. Save as `serviceAccountKey.json` in this directory
4. **Never commit this file** (it's in .gitignore)

## Adding Event Sources

In `oracle-daemon.js`, events are resolved by their `source` field:

| Source format                        | API used           |
|--------------------------------------|--------------------|
| `api:coingecko:kaspa>0.15`           | CoinGecko (free)   |
| `api:kaspa:daa>42000000`             | Kaspa REST         |
| `api:openligadb:bl1:34:2025`         | OpenLigaDB (free)  |
| `api:theoddsapi:soccer_epl:City_vs_Arsenal` | TheOddsAPI |
| `api:manual`                         | Skip (UI only)     |

## GitHub Actions (Free, Always-On)

1. Push this repo to GitHub (private)
2. Add these GitHub Secrets:
   - `ORACLE_MNEMONIC` — your oracle wallet mnemonic
   - `FIREBASE_DB_URL` — your Firebase RTDB URL
   - `FIREBASE_SERVICE_KEY_JSON` — paste the entire serviceAccountKey.json content
3. The cron runs every 5 minutes automatically

## Firebase Rules

Add to your database rules to allow daemon writes to /attestations:
```json
"attestations": {
  "$eventId": {
    ".write": true,
    ".read": true
  }
}
```
