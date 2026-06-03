const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Positions table (Polymarket positions)
    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        condition_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        outcome TEXT NOT NULL,
        price REAL NOT NULL,
        value INTEGER NOT NULL,
        pnl INTEGER NOT NULL,
        pnl_pct REAL NOT NULL,
        shares INTEGER NOT NULL,
        category TEXT NOT NULL,
        slug TEXT,
        detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Kalshi matches table
    await client.query(`
      CREATE TABLE IF NOT EXISTS kalshi_matches (
        id SERIAL PRIMARY KEY,
        poly_condition_id TEXT UNIQUE NOT NULL,
        ticker TEXT NOT NULL,
        title TEXT NOT NULL,
        yes_price REAL NOT NULL,
        category TEXT NOT NULL,
        matched BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Trade log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS trade_log (
        id SERIAL PRIMARY KEY,
        time TEXT NOT NULL,
        event TEXT NOT NULL,
        market TEXT NOT NULL,
        outcome TEXT NOT NULL,
        poly_price TEXT NOT NULL,
        kalshi_ticker TEXT,
        size TEXT,
        status TEXT NOT NULL,
        pnl TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Live activity log
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        time TEXT NOT NULL,
        msg TEXT NOT NULL,
        type TEXT DEFAULT 'info',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default settings
    const settings = [
      { key: 'copy_amount', value: '100' },
      { key: 'max_per_trade', value: '250' },
      { key: 'min_edge', value: '3' },
      { key: 'auto_close', value: 'true' },
      { key: 'is_running', value: 'false' },
    ];

    for (const setting of settings) {
      await client.query(`
        INSERT INTO settings (key, value) 
        VALUES ($1, $2)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value]);
    }

    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

// Settings helpers
async function getSetting(key) {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows[0] ? result.rows[0].value : null;
}

async function setSetting(key, value) {
  await pool.query(`
    INSERT INTO settings (key, value) 
    VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
  `, [key, value]);
}

async function getAllSettings() {
  const result = await pool.query('SELECT key, value FROM settings');
  const settings = {};
  result.rows.forEach(row => {
    settings[row.key] = row.value;
  });
  return settings;
}

// Position helpers
async function upsertPosition(position) {
  await pool.query(`
    INSERT INTO positions (condition_id, title, outcome, price, value, pnl, pnl_pct, shares, category, slug)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (condition_id) DO UPDATE SET
      title = EXCLUDED.title,
      outcome = EXCLUDED.outcome,
      price = EXCLUDED.price,
      value = EXCLUDED.value,
      pnl = EXCLUDED.pnl,
      pnl_pct = EXCLUDED.pnl_pct,
      shares = EXCLUDED.shares,
      category = EXCLUDED.category,
      slug = EXCLUDED.slug,
      updated_at = CURRENT_TIMESTAMP
  `, [
    position.conditionId,
    position.title,
    position.outcome,
    position.price,
    position.value,
    position.pnl,
    position.pnlPct,
    position.shares,
    position.category,
    position.slug
  ]);
}

async function getPositions() {
  const result = await pool.query('SELECT * FROM positions ORDER BY updated_at DESC');
  return result.rows;
}

async function getPosition(conditionId) {
  const result = await pool.query('SELECT * FROM positions WHERE condition_id = $1', [conditionId]);
  return result.rows[0];
}

// Kalshi match helpers
async function upsertKalshiMatch(match) {
  await pool.query(`
    INSERT INTO kalshi_matches (poly_condition_id, ticker, title, yes_price, category, matched)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (poly_condition_id) DO UPDATE SET
      ticker = EXCLUDED.ticker,
      title = EXCLUDED.title,
      yes_price = EXCLUDED.yes_price,
      category = EXCLUDED.category,
      matched = EXCLUDED.matched
  `, [
    match.polyConditionId,
    match.ticker,
    match.title,
    match.yes_price,
    match.category,
    match.matched
  ]);
}

async function getKalshiMatches() {
  const result = await pool.query('SELECT * FROM kalshi_matches');
  return result.rows;
}

async function getKalshiMatch(polyConditionId) {
  const result = await pool.query('SELECT * FROM kalshi_matches WHERE poly_condition_id = $1', [polyConditionId]);
  return result.rows[0];
}

// Trade log helpers
async function addTradeLog(entry) {
  await pool.query(`
    INSERT INTO trade_log (time, event, market, outcome, poly_price, kalshi_ticker, size, status, pnl)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    entry.time,
    entry.event,
    entry.market,
    entry.outcome,
    entry.polyPrice,
    entry.kalshiTicker,
    entry.size,
    entry.status,
    entry.pnl
  ]);
}

async function getTradeLog(limit = 50) {
  const result = await pool.query('SELECT * FROM trade_log ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows;
}

// Activity log helpers
async function addActivityLog(msg, type = 'info') {
  const time = new Date().toLocaleTimeString();
  await pool.query(`
    INSERT INTO activity_log (time, msg, type) VALUES ($1, $2, $3)
  `, [time, msg, type]);
}

async function getActivityLog(limit = 50) {
  const result = await pool.query('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows;
}

module.exports = {
  pool,
  initDatabase,
  getSetting,
  setSetting,
  getAllSettings,
  upsertPosition,
  getPositions,
  getPosition,
  upsertKalshiMatch,
  getKalshiMatches,
  getKalshiMatch,
  addTradeLog,
  getTradeLog,
  addActivityLog,
  getActivityLog,
};
