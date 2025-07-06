const express = require('express');
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

const app = express();

app.get('/', async (req, res) => {
  try {
    const snapshot = await usersRef.once('value');
    const users = snapshot.val() || {};
    let html = `
      <html>
      <head>
        <title>Mining User Balances</title>
        <style>
          body { font-family: sans-serif; margin:40px;}
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; }
          th { background: #f4f4f4; }
        </style>
      </head>
      <body>
        <h2>Mining User Balances</h2>
        <table>
          <thead>
            <tr>
              <th>User ID</th>
              <th>Balance</th>
              <th>Is Mining?</th>
              <th>Last Update</th>
            </tr>
          </thead>
          <tbody>
    `;
    Object.entries(users).forEach(([uid, user]) => {
      html += `
        <tr>
          <td>${uid}</td>
          <td>${(user.balance||0).toFixed(5)}</td>
          <td>${user.mining && user.mining.isMining ? "Yes" : "No"}</td>
          <td>${user.mining && user.mining.lastUpdate ? new Date(user.mining.lastUpdate).toLocaleString() : ""}</td>
        </tr>
      `;
    });
    html += `
          </tbody>
        </table>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    res.status(500).send('Error fetching balances');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Web server running on port', PORT);
});
