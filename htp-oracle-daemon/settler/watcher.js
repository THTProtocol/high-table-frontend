require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const admin = require('firebase-admin');
if (!admin.apps.length) {
  const keyPath = require('path').join(__dirname, '../serviceAccountKey.json');
  const svc = require(keyPath);
  admin.initializeApp({ credential: admin.credential.cert(svc), databaseURL: process.env.FIREBASE_DB_URL });
}
const db = admin.database();
const TIMEOUT_MS = 10 * 60 * 1000;
async function poll() {
  const snap = await db.ref('matches').once('value').catch(() => null);
  if (!snap || !snap.val()) { console.log('[Settler] No matches yet'); return; }
  const now = Date.now();
  for (const [id, m] of Object.entries(snap.val())) {
    if (m.info && m.info.status === 'waiting' && now - (m.info.created || 0) > TIMEOUT_MS) {
      await db.ref('matches/'+id+'/info/status').set('expired');
      await db.ref('matches/'+id+'/info/expiredAt').set(now);
      console.log('[Settler] Expired match', id);
    }
    if (m.info && m.info.status === 'finished' && !m.info.settleChecked) {
      await db.ref('matches/'+id+'/info/settleChecked').set(true);
      await db.ref('matches/'+id+'/info/settleStatus').set({ status: 'awaiting_wallet_signature', checkedAt: now });
      console.log('[Settler] Flagged match', id);
    }
  }
}
console.log('[HTP Settlement Watcher v1.0]');
poll();
if (process.env._HTP_ONCE !== 'true') setInterval(poll, 30000);
