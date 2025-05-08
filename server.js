const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const { Expo } = require('expo-server-sdk');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const expo = new Expo();
const MONGO_URI = process.env.MONGO_URI;

let db, tokensCollection, distancesCollection;
let dbConnected = false;

// MongoDB Connection
MongoClient.connect(MONGO_URI)
  .then((client) => {
    db = client.db('ultrasense');
    tokensCollection = db.collection('push_tokens');
    distancesCollection = db.collection('distances');
    dbConnected = true;
    console.log('✅ MongoDB connected successfully');
    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// Middleware to check DB connection
app.use((req, res, next) => {
  if (!dbConnected) return res.status(503).send('Service unavailable: DB not connected');
  next();
});

// Register push token
app.post('/register-token', async (req, res) => {
  const { token, experienceId } = req.body;
  if (!token || !experienceId) return res.status(400).send('Missing token or experienceId');

  try {
    await tokensCollection.updateOne(
      { token },
      { $set: { token, experienceId, registeredAt: new Date() } },
      { upsert: true }
    );
    res.send('✅ Token registered');
  } catch (err) {
    console.error('❌ Error registering token:', err.message);
    res.status(500).send('Error registering token');
  }
});

// Receive and process distance
app.post('/send-distance', async (req, res) => {
  const { distance } = req.body;
  if (typeof distance !== 'number') return res.status(400).send('Invalid distance');

  try {
    await distancesCollection.insertOne({ distance, createdAt: new Date() });

    if (distance > 100) {
      const allTokens = await tokensCollection.find({}).toArray();

      const grouped = allTokens.reduce((acc, { token, experienceId }) => {
        if (!acc[experienceId]) acc[experienceId] = [];
        acc[experienceId].push(token);
        return acc;
      }, {});

      for (const [experienceId, tokens] of Object.entries(grouped)) {
        const messages = tokens.map((pushToken) => {
          if (!Expo.isExpoPushToken(pushToken)) return null;
          return {
            to: pushToken,
            sound: 'default',
            body: `Alert 🚨 Distance too high: ${distance.toFixed(2)} cm!`,
            data: { distance },
            _experienceId: experienceId
          };
        }).filter(Boolean);

        const chunks = expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
          try {
            const response = await expo.sendPushNotificationsAsync(chunk);
            console.log(`📤 Push notification response for ${experienceId}:`, response);
          } catch (err) {
            console.error('❌ Error sending push notification:', err.message);
          }
        }
      }
    }

    res.send('📏 Distance received');
  } catch (err) {
    console.error('❌ Error storing distance:', err.message);
    res.status(500).send('Error storing distance');
  }
});

// Get latest distance
app.get('/latest-distance', async (req, res) => {
  try {
    const latest = await distancesCollection.find().sort({ createdAt: -1 }).limit(1).toArray();
    res.json(latest[0] || { distance: null });
  } catch (err) {
    console.error('❌ Error fetching distance:', err.message);
    res.status(500).send('Error fetching distance');
  }
});

// Fallback route (404)
app.use((req, res) => {
  res.status(404).send(`❌ Route not found: ${req.originalUrl}`);
});
