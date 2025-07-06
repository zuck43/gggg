const admin = require('firebase-admin');

if (!process.env.FIREBASE_CREDENTIALS) {
  console.error('FIREBASE_CREDENTIALS environment variable is not set!');
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://starx-network-default-rtdb.firebaseio.com"
  });
}

const db = admin.database();
const usersRef = db.ref('users');

const MINING_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const BASE_COINS_PER_HOUR = 2.0;
const BOOST_PER_REFERRAL = 0.25;

async function getFirebaseServerTime() {
  const ref = db.ref('serverTimeForScript');
  await ref.set(admin.database.ServerValue.TIMESTAMP);
  const snap = await ref.once('value');
  return snap.val();
}

async function getActiveReferralCount(referralCode) {
  if (!referralCode) return 0;
  const usersSnap = await usersRef.orderByChild('referredBy').equalTo(referralCode).once('value');
  let count = 0;
  usersSnap.forEach(child => {
    const mining = child.child('mining').val();
    if (mining && mining.isMining) count++;
  });
  return count;
}

async function processUser(uid, userData, now) {
  const mining = userData.mining;
  if (!mining || !mining.isMining || !mining.startTime) return null;

  const lastUpdate = mining.lastUpdate || mining.startTime;
  const miningEndTime = mining.startTime + MINING_DURATION_MS;
  const creditUntil = Math.min(now, miningEndTime);

  const isMiningDone = creditUntil >= miningEndTime;
  let elapsedMinutes = isMiningDone
    ? Math.floor((miningEndTime - lastUpdate) / (60 * 1000))
    : Math.round((creditUntil - lastUpdate) / (60 * 1000));

  if (elapsedMinutes <= 0) return null;

  let speedBoost = 0.0;
  if (userData.referralCode) {
    speedBoost = await getActiveReferralCount(userData.referralCode) * BOOST_PER_REFERRAL;
  }
  const coinsPerMinute = (BASE_COINS_PER_HOUR + speedBoost) / 60.0;
  const coinsToAdd = elapsedMinutes * coinsPerMinute;
  const prevBalance = Number(userData.balance) || 0;
  const newBalance = prevBalance + coinsToAdd;

  await usersRef.child(uid).update({
    balance: newBalance,
    'mining/isMining': !isMiningDone,
    'mining/lastUpdate': creditUntil,
  });

  console.log(
    `User ${uid}: +${coinsToAdd.toFixed(5)} coins (boost: ${speedBoost.toFixed(2)}), minutes: ${elapsedMinutes}, mining ${isMiningDone ? "ended" : "continues"}.`
  );
}

async function main() {
  try {
    const now = await getFirebaseServerTime();
    const snapshot = await usersRef.once('value');
    const users = snapshot.val() || {};

    await Promise.all(
      Object.entries(users).map(([uid, userData]) => processUser(uid, userData, now))
    );

    console.log('Mining credit job completed.');
    process.exit(0);
  } catch (error) {
    console.error('Error in mining job:', error);
    process.exit(1);
  }
}

main();
