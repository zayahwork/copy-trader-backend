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
    const settings = await getAllSettings();
    const positions = await getPositions();
    const ourPositions = await require('./database').getOurPositions();
    const tradeLog = await getTradeLog(30);
    
    // Calculate demo portfolio stats
    const startingBalance = parseFloat(settings.starting_balance || '11.00');
    const totalInvested = ourPositions.reduce((sum, p) => sum + (p.entry_price * p.count), 0);
    const currentValue = ourPositions.reduce((sum, p) => sum + (p.count * 0.5), 0); // Simplified for demo
    const totalPnl = currentValue - totalInvested;
    
    const data = {
      settings,
      positions,
      ourPositions,
      kalshiMatches: await getKalshiMatches(),
      tradeLog,
      activityLog: await getActivityLog(50),
      portfolio: {
        startingBalance: startingBalance.toFixed(2),
        totalInvested: totalInvested.toFixed(2),
        currentValue: currentValue.toFixed(2),
        totalPnl: totalPnl.toFixed(2),
        openPositions: ourPositions.length,
        totalTrades: tradeLog.filter(t => t.event === 'Auto-copied (demo)' || t.event === 'Auto-copied').length
      }
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
    
    // Process new positions (max 5 per poll)
    const maxToProcess = Math.min(newPositions.length, 5);
    for (let i = 0; i < maxToProcess; i++) {
      await processNewPosition(newPositions[i]);
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

// Test endpoint - simulate a new Ferrari trade
app.post('/api/test-trade', async (req, res) => {
  try {
    const testPosition = {
      conditionId: '0xTEST' + Date.now(),
      title: 'Test Market: Lakers vs Warriors',
      outcome: 'Lakers',
      price: 0.55,
      avgPrice: 0.55,
      value: 100,
      pnl: 0,
      pnlPct: 0,
      shares: 181,
      category: 'NBA',
      slug: 'test-market',
      redeemable: false
    };
    
    await addActivityLog('TEST: Simulating new Ferrari trade', 'info');
    const result = await processNewPosition(testPosition);
    
    res.json({ 
      success: true, 
      message: 'Test trade executed - check Trade Log and Activity Log',
      position: testPosition
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Scheduled polling job (every 5 seconds)
cron.schedule('*/5 * * * * *', async () => {
  try {
    const isRunning = await getSetting('is_running') === 'true';
    if (!isRunning) {
      return;
    }

    await addActivityLog('Scheduled poll - checking Polymarket', 'info');
    const newPositions = await updatePositions();
    const currentPositions = await getPositions();
    
    // Process new positions (max 5 per poll to prevent spam)
    const maxToProcess = Math.min(newPositions.length, 5);
    if (newPositions.length > 0) {
      await addActivityLog(`Processing ${maxToProcess} of ${newPositions.length} new positions`, 'info');
    }
    for (let i = 0; i < maxToProcess; i++) {
      await processNewPosition(newPositions[i]);
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
