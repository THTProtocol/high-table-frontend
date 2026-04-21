require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const WebSocket = require('ws');
const admin = require('firebase-admin');
if (!admin.apps.length) {
  const keyPath = require('path').join(__dirname, '../serviceAccountKey.json');
  const svc = require(keyPath);
  admin.initializeApp({ credential: admin.credential.cert(svc), databaseURL: process.env.FIREBASE_DB_URL });
}
const db = admin.database();
const NET = process.env.NETWORK || 'tn12';
const FEE = process.env.FEE_ADDRESS || 'kaspatest:qpyfz03k6quxwf2jglwkhczvt758d8xrq99gl37p6h3vsqur27ltjhn68354m';
const WS_URL = { tn12: 'ws://127.0.0.1:18210', mainnet: 'ws://127.0.0.1:18110' };

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL[NET]);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('timeout')); }, 8000);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method, params: params || [] })));
    ws.on('message', d => {
      clearTimeout(timer);
      try { resolve(JSON.parse(d.toString())); } catch(e) { reject(e); }
      ws.close();
    });
    ws.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

async function poll() {
  try {
    const [dagRes, balRes] = await Promise.all([
      rpcCall('getBlockDagInfo', []),
      rpcCall('getBalanceByAddress', [{ address: FEE }])
    ]);
    const daa = parseInt(dagRes?.result?.virtualDaaScore || dagRes?.params?.virtualDaaScore || 0);
    const sompi = parseInt(balRes?.result?.balance || 0);
    const bal = sompi / 1e8;
    await db.ref('treasury/'+NET+'/live').set({ daa, balanceKas: bal, updatedAt: Date.now(), network: NET });
    const snap = await db.ref('treasury/'+NET+'/allTime').once('value');
    const at = snap.val() || { totalFeesKas: 0, blockCount: 0 };
    at.blockCount++; at.currentBalanceKas = bal; at.lastUpdated = Date.now();
    await db.ref('treasury/'+NET+'/allTime').set(at);
    console.log('[Miner] DAA', daa, '| Balance', bal.toFixed(4), 'KAS');
  } catch(e) { console.warn('[Miner]', e.message); }
}

console.log('[HTP Miner Monitor v1.0]', NET);
poll();
if (process.env._HTP_ONCE !== 'true') setInterval(poll, 15000);
