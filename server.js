require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { 
  initDatabase, 
  getSetting, 
  setSetting, 
  getAllSettings,
  getPositions, 
  getKalshiMatches, 
  getTradeLog, 
  getActivityLog,
  addActivityLog 
} = require('./database');
const { updatePositions } = require('./polymarket');
const { processNewPosition } = require('./kalshi');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
initDatabase();

// API Routes

// Get all data for the frontend
app.get('/api/data', (req, res) => {
  try {
    const data = {
      settings: getAllSettings(),
      positions: getPositions(),
      kalshiMatches: getKalshiMatches(),
      tradeLog: getTradeLog(30),
      activityLog: getActivityLog(50)
    };
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get settings
app.get('/api/settings', (req, res) => {
  try {
    res.json(getAllSettings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update settings
app.post('/api/settings', (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value required' });
    }
    setSetting(key, value);
    addActivityLog(`Setting updated: ${key} = ${value}`, 'info');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get positions
app.get('/api/positions', (req, res) => {
  try {
    res.json(getPositions());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Kalshi matches
app.get('/api/matches', (req, res) => {
  try {
    res.json(getKalshiMatches());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get trade log
app.get('/api/trade-log', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(getTradeLog(limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get activity log
app.get('/api/activity-log', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(getActivityLog(limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start/stop copy trader
app.post('/api/toggle', (req, res) => {
  try {
    const current = getSetting('is_running') === 'true';
    const newValue = !current;
    setSetting('is_running', newValue.toString());
    addActivityLog(`Copy trader ${newValue ? 'started' : 'stopped'}`, newValue ? 'success' : 'info');
    res.json({ isRunning: newValue });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual poll trigger
app.post('/api/poll', async (req, res) => {
  try {
    addActivityLog('Manual poll triggered', 'info');
    const newPositions = await updatePositions();
    
    // Process new positions
    for (const position of newPositions) {
      await processNewPosition(position);
    }
    
    res.json({ newPositions: newPositions.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Scheduled polling job (every 30 seconds)
cron.schedule('*/30 * * * * *', async () => {
  try {
    const isRunning = getSetting('is_running') === 'true';
    if (!isRunning) {
      return;
    }

    addActivityLog('Scheduled poll - checking Polymarket', 'info');
    const newPositions = await updatePositions();
    
    // Process new positions
    for (const position of newPositions) {
      await processNewPosition(position);
    }
  } catch (error) {
    addActivityLog(`Poll error: ${error.message}`, 'error');
    console.error('Poll error:', error);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Copy trader backend running on port ${PORT}`);
  addActivityLog('Server started', 'success');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  addActivityLog('Server shutting down', 'info');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  addActivityLog('Server shutting down', 'info');
  process.exit(0);
});
