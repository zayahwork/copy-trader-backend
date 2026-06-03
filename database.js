const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'copy-trader.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize tables
function initDatabase() {
  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Positions table (Polymarket positions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS kalshi_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poly_condition_id TEXT UNIQUE NOT NULL,
      ticker TEXT NOT NULL,
      title TEXT NOT NULL,
      yes_price REAL NOT NULL,
      category TEXT NOT NULL,
      matched BOOLEAN DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Trade log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);

  const transaction = db.transaction(settings);
  transaction(s => insertSetting.run(s.key, s.value));

  console.log('Database initialized successfully');
}

// Settings helpers
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `).run(key, value, value);
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(row => {
    settings[row.key] = row.value;
  });
  return settings;
}

// Position helpers
function upsertPosition(position) {
  db.prepare(`
    INSERT INTO positions (condition_id, title, outcome, price, value, pnl, pnl_pct, shares, category, slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(condition_id) DO UPDATE SET
      title = excluded.title,
      outcome = excluded.outcome,
      price = excluded.price,
      value = excluded.value,
      pnl = excluded.pnl,
      pnl_pct = excluded.pnl_pct,
      shares = excluded.shares,
      category = excluded.category,
      slug = excluded.slug,
      updated_at = CURRENT_TIMESTAMP
  `).run(
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
  );
}

function getPositions() {
  return db.prepare('SELECT * FROM positions ORDER BY updated_at DESC').all();
}

function getPosition(conditionId) {
  return db.prepare('SELECT * FROM positions WHERE condition_id = ?').get(conditionId);
}

// Kalshi match helpers
function upsertKalshiMatch(match) {
  db.prepare(`
    INSERT INTO kalshi_matches (poly_condition_id, ticker, title, yes_price, category, matched)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(poly_condition_id) DO UPDATE SET
      ticker = excluded.ticker,
      title = excluded.title,
      yes_price = excluded.yes_price,
      category = excluded.category,
      matched = excluded.matched
  `).run(
    match.polyConditionId,
    match.ticker,
    match.title,
    match.yes_price,
    match.category,
    match.matched ? 1 : 0
  );
}

function getKalshiMatches() {
  return db.prepare('SELECT * FROM kalshi_matches').all();
}

function getKalshiMatch(polyConditionId) {
  return db.prepare('SELECT * FROM kalshi_matches WHERE poly_condition_id = ?').get(polyConditionId);
}

// Trade log helpers
function addTradeLog(entry) {
  db.prepare(`
    INSERT INTO trade_log (time, event, market, outcome, poly_price, kalshi_ticker, size, status, pnl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.time,
    entry.event,
    entry.market,
    entry.outcome,
    entry.polyPrice,
    entry.kalshiTicker,
    entry.size,
    entry.status,
    entry.pnl
  );
}

function getTradeLog(limit = 50) {
  return db.prepare('SELECT * FROM trade_log ORDER BY created_at DESC LIMIT ?').all(limit);
}

// Activity log helpers
function addActivityLog(msg, type = 'info') {
  const time = new Date().toLocaleTimeString();
  db.prepare(`
    INSERT INTO activity_log (time, msg, type) VALUES (?, ?, ?)
  `).run(time, msg, type);
}

function getActivityLog(limit = 50) {
  return db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit);
}

module.exports = {
  db,
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
