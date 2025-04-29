const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');

const app = express();
const port = 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MongoDB connection
const uri = "process.env.MONGODB_URI";
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

// Global token storage
let expoPushToken = null;

// Distance limit for alert
const DISTANCE_LIMIT = 100; // Distance limit in cm

// Connect to MongoDB Atlas
async function connectMongoDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}
connectMongoDB();

// Register Expo push token
app.post('/register-token', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).send('Token is required');
  }

  expoPushToken = token;
  console.log('Expo Push Token registered:', token);

  try {
    const collection = client.db("ultrasense").collection("push_tokens");
    await collection.insertOne({ token, registeredAt: new Date() });
    res.send('✅ Token received and stored');
  } catch (error) {
    console.error('❌ Error storing token:', error);
    res.status(500).send('Error storing token');
  }
});

// Receive distance data from ESP32
app.post('/distance', async (req, res) => {
  const { distance } = req.body;

  if (distance == null || isNaN(distance)) {
    return res.status(400).send('Invalid distance value');
  }

  console.log(`📏 Distance received: ${distance} cm`);

  try {
    const collection = client.db("ultrasense").collection("distance_data");
    await collection.insertOne({ distance, timestamp: new Date() });

    // Send notification if distance exceeds limit
    if (distance >=DISTANCE_LIMIT && expoPushToken) {
      console.log('🚨 Distance limit crossed! Sending notification...');
      await sendPushNotification(expoPushToken, distance);
    }

    res.send('✅ Distance processed and stored');
  } catch (error) {
    console.error('❌ Error storing distance data:', error);
    res.status(500).send('Error storing distance data');
  }
});

// Get the latest distance reading
app.get('/latest-distance', async (req, res) => {
  try {
    const collection = client.db("ultrasense").collection("distance_data");
    const latestData = await collection.find().sort({ timestamp: -1 }).limit(1).toArray();

    if (latestData.length === 0) {
      return res.status(404).send('No distance data yet');
    }

    res.json({ distance: latestData[0].distance });
  } catch (error) {
    console.error('❌ Error fetching latest distance:', error);
    res.status(500).send('Internal server error');
  }
});

// Send push notification function
async function sendPushNotification(token, distance) {
  const message = {
    to: token,
    sound: 'default',
    title: '🚨 Distance Alert!',
    body: `Object detected at ${distance.toFixed(2)} cm.`,
    priority: "high",
    vibrate: [0, 250, 250, 250],
    data: { distance },
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const data = await response.json();
    console.log('📤 Push notification response:', JSON.stringify(data));
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
  }
}

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://0.0.0.0:${port}`);
});
