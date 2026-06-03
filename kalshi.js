const axios = require('axios');
const { upsertKalshiMatch, addActivityLog, addTradeLog, getSetting, getKalshiMatch } = require('./database');

const KALSHI_API = process.env.KALSHI_API || 'https://api.kalshi.co/v1';
const KALSHI_API_KEY_ID = process.env.KALSHI_API_KEY_ID;
const KALSHI_API_KEY_SECRET = process.env.KALSHI_API_KEY_SECRET;

/**
 * Create authenticated axios instance for Kalshi
 */
function createKalshiClient() {
  const client = axios.create({
    baseURL: KALSHI_API,
    headers: {
      'Content-Type': 'application/json'
    }
  });

  // Add auth interceptor if credentials are available
  if (KALSHI_API_KEY_ID && KALSHI_API_KEY_SECRET) {
    client.interceptors.request.use(config => {
      config.headers['X-KALSHI-API-KEY-ID'] = KALSHI_API_KEY_ID;
      config.headers['X-KALSHI-API-KEY-SECRET'] = KALSHI_API_KEY_SECRET;
      return config;
    });
  }

  return client;
}

/**
 * Search for Kalshi markets matching a Polymarket position
 */
async function findMatchingMarket(position) {
  try {
    const client = createKalshiClient();
    
    // Search by title keywords
    const keywords = position.title
      .toLowerCase()
      .replace(/vs\.?/g, ' ')
      .split(' ')
      .filter(w => w.length > 3)
      .slice(0, 3);

    if (keywords.length === 0) {
      return null;
    }

    const response = await client.get('/markets', {
      params: {
        limit: 20,
        status: 'open'
      }
    });

    if (!response.data?.markets) {
      return null;
    }

    // Simple matching logic - can be improved
    const match = response.data.markets.find(market => {
      const marketTitle = market.title.toLowerCase();
      return keywords.some(kw => marketTitle.includes(kw));
    });

    if (match) {
      return {
        polyConditionId: position.conditionId,
        ticker: market.ticker,
        title: market.title,
        yes_price: market.yes_price / 100, // Convert to decimal
        category: position.category,
        matched: true
      };
    }

    return null;
  } catch (error) {
    addActivityLog(`Kalshi search error: ${error.message}`, 'warn');
    return null;
  }
}

/**
 * Place an order on Kalshi
 */
async function placeOrder(ticker, side, count, price) {
  try {
    const client = createKalshiClient();
    
    const response = await client.post('/trade', {
      ticker,
      side,
      count,
      price
    });

    addActivityLog(`Order placed: ${ticker} ${side} ${count} @ ${price}`, 'success');
    return response.data;
  } catch (error) {
    addActivityLog(`Order failed: ${error.message}`, 'error');
    console.error('Kalshi order error:', error);
    return null;
  }
}

/**
 * Process a new position and attempt to copy trade
 */
async function processNewPosition(position) {
  // Check if we already have a match
  const existingMatch = getKalshiMatch(position.conditionId);
  
  if (existingMatch) {
    // Use existing match
    return executeCopyTrade(position, existingMatch);
  }

  // Try to find a match
  const match = await findMatchingMarket(position);
  
  if (!match) {
    addActivityLog(`No Kalshi match for: ${position.title}`, 'warn');
    upsertKalshiMatch({
      polyConditionId: position.conditionId,
      ticker: 'N/A',
      title: 'No match found',
      yes_price: 0,
      category: position.category,
      matched: false
    });
    return null;
  }

  upsertKalshiMatch(match);
  return executeCopyTrade(position, match);
}

/**
 * Execute the copy trade if conditions are met
 */
async function executeCopyTrade(position, match) {
  const isRunning = getSetting('is_running') === 'true';
  if (!isRunning) {
    addActivityLog(`Copy trader paused - skipping ${position.title}`, 'info');
    return null;
  }

  const copyAmount = parseInt(getSetting('copy_amount') || '100');
  const maxPerTrade = parseInt(getSetting('max_per_trade') || '250');
  const minEdge = parseInt(getSetting('min_edge') || '3');

  // Calculate trade size
  const size = Math.min(maxPerTrade, Math.round(position.value * (copyAmount / 100)));

  // Check price edge
  const priceDiff = Math.abs(match.yes_price - position.price);
  if (priceDiff * 100 < minEdge) {
    addActivityLog(`Price edge too small (${(priceDiff * 100).toFixed(1)}¢ < ${minEdge}¢) - skipping`, 'info');
    return null;
  }

  // Place order (if API keys are configured)
  if (KALSHI_API_KEY_ID && KALSHI_API_KEY_SECRET) {
    const result = await placeOrder(match.ticker, 'yes', Math.round(size / match.yes_price), match.yes_price);
    
    if (result) {
      addTradeLog({
        time: new Date().toLocaleTimeString(),
        event: 'Auto-copied',
        market: position.title,
        outcome: `${position.outcome} YES`,
        polyPrice: `${(position.price * 100).toFixed(1)}¢`,
        kalshiTicker: match.ticker,
        size: `$${size}`,
        status: 'executed',
        pnl: null
      });
      return result;
    }
  } else {
    // Simulate trade if no API keys
    addActivityLog(`Simulated trade: ${match.ticker} YES @ ${(match.yes_price * 100).toFixed(0)}¢ · $${size}`, 'success');
    addTradeLog({
      time: new Date().toLocaleTimeString(),
      event: 'Auto-copied (simulated)',
      market: position.title,
      outcome: `${position.outcome} YES`,
      polyPrice: `${(position.price * 100).toFixed(1)}¢`,
      kalshiTicker: match.ticker,
      size: `$${size}`,
      status: 'executed',
      pnl: null
    });
  }

  return null;
}

module.exports = {
  findMatchingMarket,
  placeOrder,
  processNewPosition
};
