const express = require('express');
const admin = require('firebase-admin');

// Load credentials from environment variables
const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
};

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://starx-network-default-rtdb.firebaseio.com',
  });
}

const db = admin.database();
const usersRef = db.ref('users');

const app = express();

// Constants
const MINING_DURATION_MS = 24 * 60 * 60 * 1000;
const BASE_COINS_PER_HOUR = 2.0;
const BOOST_PER_REFERRAL = 0.25;

// Firebase server time
async function getFirebaseServerTime() {
  const ref = db.ref('serverTimeForScript');
  await ref.set(admin.database.ServerValue.TIMESTAMP);
  const snap = await ref.once('value');
  return snap.val();
}

// Count active referrals
async function getActiveReferralCount(referralCode) {
  if (!referralCode) return 0;
  const snap = await usersRef.orderByChild('referredBy').equalTo(referralCode).once('value');
  let count = 0;
  snap.forEach(child => {
    const mining = child.child('mining').val();
    if (mining?.isMining) count++;
  });
  return count;
}

// Process mining for one user
async function processUser(uid, userData, now) {
  const mining = userData.mining;
  if (!mining?.isMining || !mining.startTime) return;

  const lastUpdate = mining.lastUpdate || mining.startTime;
  const miningEnd = mining.startTime + MINING_DURATION_MS;
  const creditUntil = Math.min(now, miningEnd);
  const isDone = creditUntil >= miningEnd;

  const elapsedMinutes = Math.floor((creditUntil - lastUpdate) / (60 * 1000));
  if (elapsedMinutes <= 0) return;

  let boost = 0;
  if (userData.referralCode) {
    boost = await getActiveReferralCount(userData.referralCode) * BOOST_PER_REFERRAL;
  }

  const coinsPerMin = (BASE_COINS_PER_HOUR + boost) / 60;
  const earned = elapsedMinutes * coinsPerMin;
  const newBalance = (userData.balance || 0) + earned;

  await usersRef.child(uid).update({
    balance: newBalance,
    'mining/isMining': !isDone,
    'mining/lastUpdate': creditUntil,
  });

  console.log(`✅ ${uid}: +${earned.toFixed(4)} coins (boost: ${boost.toFixed(2)}), mining ${isDone ? "stopped" : "ongoing"}`);
}

// Mining job
async function runMiningJob() {
  const now = await getFirebaseServerTime();
  const snap = await usersRef.once('value');
  const users = snap.val() || {};

  await Promise.all(
    Object.entries(users).map(async ([uid, data]) => {
      try {
        await processUser(uid, data, now);
      } catch (err) {
        console.error(`❌ Error processing ${uid}:`, err.message);
      }
    })
  );

  console.log('🎯 Mining job finished.');
}

// Dashboard page
app.get('/', async (req, res) => {
  const snap = await usersRef.once('value');
  const users = snap.val() || {};
  let html = `<html><head><title>Balances</title><style>body{font-family:sans-serif;}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px}</style></head><body><h2>🧾 User Balances</h2><table><tr><th>UID</th><th>Balance</th><th>Mining?</th><th>Last Update</th></tr>`;
  for (const [uid, u] of Object.entries(users)) {
    html += `<tr><td>${uid}</td><td>${(u.balance || 0).toFixed(5)}</td><td>${u.mining?.isMining ? '✅' : '❌'}</td><td>${u.mining?.lastUpdate ? new Date(u.mining.lastUpdate).toLocaleString() : ''}</td></tr>`;
  }
  html += '</table></body></html>';
  res.send(html);
});

// Manual trigger
app.get('/run', async (req, res) => {
  try {
    await runMiningJob();
    res.send('✅ Mining job executed successfully.');
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Error running mining job.');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
