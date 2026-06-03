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
const { processNewPosition, checkForClosedPositions } = require('./kalshi');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
initDatabase().then(() => {
  console.log('Database initialized');
}).catch(err => {
  console.error('Failed to initialize database:', err);
});

// API Routes

// Get all data for the frontend
app.get('/api/data', async (req, res) => {
  try {
    const data = {
      settings: await getAllSettings(),
      positions: await getPositions(),
      kalshiMatches: await getKalshiMatches(),
      tradeLog: await getTradeLog(30),
      activityLog: await getActivityLog(50)
    };
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get settings
app.get('/api/settings', async (req, res) => {
  try {
    res.json(await getAllSettings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update settings
app.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value required' });
    }
    await setSetting(key, value);
    await addActivityLog(`Setting updated: ${key} = ${value}`, 'info');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get positions
app.get('/api/positions', async (req, res) => {
  try {
    res.json(await getPositions());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Kalshi matches
app.get('/api/matches', async (req, res) => {
  try {
    res.json(await getKalshiMatches());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get trade log
app.get('/api/trade-log', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(await getTradeLog(limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get activity log
app.get('/api/activity-log', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(await getActivityLog(limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start/stop copy trader
app.post('/api/toggle', async (req, res) => {
  try {
    const current = await getSetting('is_running') === 'true';
    const newValue = !current;
    await setSetting('is_running', newValue.toString());
    await addActivityLog(`Copy trader ${newValue ? 'started' : 'stopped'}`, newValue ? 'success' : 'info');
    res.json({ isRunning: newValue });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual poll trigger
app.post('/api/poll', async (req, res) => {
  try {
    await addActivityLog('Manual poll triggered', 'info');
    const newPositions = await updatePositions();
    const currentPositions = await getPositions();
    
    // Process new positions
    for (const position of newPositions) {
      await processNewPosition(position);
    }
    
    // Check for positions that need to be closed
    await checkForClosedPositions(currentPositions);
    
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
    const isRunning = await getSetting('is_running') === 'true';
    if (!isRunning) {
      return;
    }

    await addActivityLog('Scheduled poll - checking Polymarket', 'info');
    const newPositions = await updatePositions();
    const currentPositions = await getPositions();
    
    // Process new positions
    for (const position of newPositions) {
      await processNewPosition(position);
    }
    
    // Check for positions that need to be closed
    await checkForClosedPositions(currentPositions);
  } catch (error) {
    await addActivityLog(`Poll error: ${error.message}`, 'error');
    console.error('Poll error:', error);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Copy trader backend running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await addActivityLog('Server shutting down', 'info');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await addActivityLog('Server shutting down', 'info');
  process.exit(0);
});
