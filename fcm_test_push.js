const admin = require('firebase-admin');
const fs = require('fs');
const serviceAccount = JSON.parse(fs.readFileSync('firebase-service-account.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const token = "dWqbYScsSmiZOGB8lkTY4a:APA91bFtSEUa8amXSAr7j0YChKB8iBPhdyAP-OqbpFG4MN-dDYLEHWBfvyuMZXpX_Jgde4VG04YeCKIYu-Jt7PI-WCvr3ffW2IHXqkY9GmNBtjyCPYvf6oo";

admin.messaging().send({
  token: token,
  notification: { title: "Test", body: "Direct Push" },
  android: {
    priority: 'high',
    notification: { channelId: 'lark_orders' }
  }
}).then(res => {
  console.log("SUCCESS PUSH:", res);
  process.exit(0);
}).catch(err => {
  console.error("FAIL PUSH:", err);
  process.exit(1);
});
