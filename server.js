const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const { Expo } = require('expo-server-sdk');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const expo = new Expo();

app.use(cors());
app.use(bodyParser.json());

// Log environment var for diagnostics (remove in production)
console.log('📦 MONGO_URI from env:', process.env.MONGO_URI);

const MONGO_URI = process.env.MONGO_URI;

let db, tokensCollection, distancesCollection;

// Connect to MongoDB
MongoClient.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then((client) => {
    console.log('✅ MongoDB connected successfully');
    db = client.db('ultrasense');
    tokensCollection = db.collection('push_tokens');
    distancesCollection = db.collection('distances');

    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message || err);
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
    console.error('❌ Error registering token:', err);
    res.status(500).send('Error registering token');
  }
});

// Receive and store distance
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
            body: `🚨 Alert! Distance too high: ${distance.toFixed(2)} cm`,
            data: { distance },
            _experienceId: experienceId,
          };
        }).filter(Boolean);

        const chunks = expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
          try {
            const response = await expo.sendPushNotificationsAsync(chunk);
            console.log(`📤 Notification sent to ${experienceId}:`, response);
          } catch (err) {
            console.error('❌ Notification error:', err);
          }
        }
      }
    }

    res.send('📏 Distance received');
  } catch (err) {
    console.error('❌ Distance storing error:', err);
    res.status(500).send('Error storing distance');
  }
});

// Get latest distance
app.get('/latest-distance', async (req, res) => {
  try {
    const latest = await distancesCollection.find().sort({ createdAt: -1 }).limit(1).toArray();
    res.json(latest[0] || { distance: null });
  } catch (err) {
    console.error('❌ Fetch error:', err);
    res.status(500).send('Error fetching distance');
  }
});

// Catch-all for 404s
app.use((req, res) => {
  res.status(404).send(`❌ Route not found: ${req.originalUrl}`);
});
