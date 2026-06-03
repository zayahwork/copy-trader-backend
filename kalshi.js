const axios = require('axios');
const crypto = require('crypto');
const { upsertKalshiMatch, addActivityLog, addTradeLog, getSetting, getKalshiMatch, addOurPosition, getOurPositions, removeOurPosition, getOurPosition } = require('./database');

const KALSHI_API = process.env.KALSHI_API || 'https://trading-api.kalshi.com';
const KALSHI_API_KEY_ID = process.env.KALSHI_API_KEY_ID;
const KALSHI_API_KEY_SECRET = process.env.KALSHI_API_KEY_SECRET;
const DEMO_MODE = process.env.DEMO_MODE === 'true' || !KALSHI_API_KEY_SECRET;

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
  if (KALSHI_API_KEY_ID && KALSHI_API_KEY_SECRET && !DEMO_MODE) {
    client.interceptors.request.use(config => {
      try {
        const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        const method = config.method.toUpperCase();
        const url = new URL(config.url, KALSHI_API);
        const path = url.pathname + url.search;
        const body = config.data ? JSON.stringify(config.data) : '';
        
        const signString = `${timestamp}${method}${path}${body}`;
        const signature = crypto.createSign('RSA-SHA256')
          .update(signString)
          .sign(KALSHI_API_KEY_SECRET, 'base64');
        
        config.headers['KALSHI-ACCESS-KEY'] = KALSHI_API_KEY_ID;
        config.headers['KALSHI-SIGNATURE'] = signature;
        config.headers['KALSHI-TIMESTAMP'] = timestamp;
        
        delete config.headers['X-KALSHI-API-KEY-ID'];
        delete config.headers['X-KALSHI-API-KEY-SECRET'];
      } catch (err) {
        console.error('Auth signing error:', err.message);
      }
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
    await addActivityLog(`Kalshi search error: ${error.message}`, 'warn');
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

    await addActivityLog(`Order placed: ${ticker} ${side} ${count} @ ${price}`, 'success');
    return response.data;
  } catch (error) {
    await addActivityLog(`Order failed: ${error.message}`, 'error');
    console.error('Kalshi order error:', error);
    return null;
  }
}

/**
 * Close a position on Kalshi
 */
async function closePosition(ticker, side, count, price) {
  try {
    const client = createKalshiClient();
    
    const response = await client.post('/trade', {
      ticker,
      side,
      count,
      price
    });

    await addActivityLog(`Position closed: ${ticker} ${side} ${count} @ ${price}`, 'success');
    return response.data;
  } catch (error) {
    await addActivityLog(`Close failed: ${error.message}`, 'error');
    console.error('Kalshi close error:', error);
    return null;
  }
}

/**
 * Process a new position and attempt to copy trade
 */
async function processNewPosition(position) {
  // Check if we already have a match
  const existingMatch = await getKalshiMatch(position.conditionId);
  
  if (existingMatch) {
    // Use existing match
    return executeCopyTrade(position, existingMatch);
  }

  // Try to find a match
  const match = await findMatchingMarket(position);
  
  if (!match) {
    await addActivityLog(`No Kalshi match for: ${position.title}`, 'warn');
    await upsertKalshiMatch({
      polyConditionId: position.conditionId,
      ticker: 'N/A',
      title: 'No match found',
      yes_price: 0,
      category: position.category,
      matched: false
    });
    return null;
  }

  await upsertKalshiMatch(match);
  return executeCopyTrade(position, match);
}

/**
 * Execute the copy trade if conditions are met
 */
async function executeCopyTrade(position, match) {
  const isRunning = await getSetting('is_running') === 'true';
  if (!isRunning) {
    return null;
  }

  // Skip if we already have this position
  const existingPosition = await getOurPosition(position.conditionId);
  if (existingPosition) {
    return null;
  }

  const useFixedSize = await getSetting('use_fixed_size') === 'true';
  const fixedTradeSize = parseFloat(await getSetting('fixed_trade_size') || '0.50');
  const copyAmount = parseInt(await getSetting('copy_amount') || '100');
  const maxPerTrade = parseInt(await getSetting('max_per_trade') || '250');
  const minEdge = parseInt(await getSetting('min_edge') || '3');

  // Calculate trade size
  let size;
  if (useFixedSize) {
    size = fixedTradeSize;
  } else {
    size = Math.min(maxPerTrade, Math.round(position.value * (copyAmount / 100)));
  }

  // Check price edge
  const priceDiff = Math.abs(match.yes_price - position.price);
  if (priceDiff * 100 < minEdge) {
    await addActivityLog(`Price edge too small (${(priceDiff * 100).toFixed(1)}¢ < ${minEdge}¢) - skipping ${position.title}`, 'info');
    return null;
  }

  // Place order (if not in demo mode)
  if (!DEMO_MODE && KALSHI_API_KEY_ID && KALSHI_API_KEY_SECRET) {
    const count = Math.round(size / match.yes_price);
    const result = await placeOrder(match.ticker, 'yes', count, match.yes_price);
    
    if (result) {
      await addOurPosition(position.conditionId, match.ticker, 'yes', count, match.yes_price);
      
      await addTradeLog({
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
    // Demo mode - simulate trade
    await addActivityLog(`[DEMO] Simulated trade: ${match.ticker} YES @ ${(match.yes_price * 100).toFixed(0)}¢ · $${size}`, 'success');
    await addTradeLog({
      time: new Date().toLocaleTimeString(),
      event: 'Auto-copied (demo)',
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

/**
 * Check for positions that need to be closed (source trader exited)
 */
async function checkForClosedPositions(currentPolyPositions) {
  const autoClose = await getSetting('auto_close') === 'true';
  if (!autoClose) {
    return;
  }

  const ourPositions = await getOurPositions();
  const currentPolyIds = new Set(currentPolyPositions.map(p => p.condition_id));

  for (const ourPos of ourPositions) {
    if (!currentPolyIds.has(ourPos.poly_condition_id)) {
      // Source trader closed this position, we should too
      await addActivityLog(`Source trader closed position - auto-closing ${ourPos.kalshi_ticker}`, 'info');
      
      if (KALSHI_API_KEY_ID && KALSHI_API_KEY_SECRET) {
        // Close on Kalshi (sell at current market price)
        const result = await closePosition(ourPos.kalshi_ticker, 'no', ourPos.count, 1); // Sell at market
        
        if (result) {
          await addTradeLog({
            time: new Date().toLocaleTimeString(),
            event: 'Auto-closed',
            market: 'Position closed',
            outcome: `${ourPos.side} → NO`,
            polyPrice: 'N/A',
            kalshiTicker: ourPos.kalshi_ticker,
            size: `${ourPos.count} contracts`,
            status: 'closed',
            pnl: null
          });
        }
      } else {
        // Simulate close
        await addActivityLog(`Simulated close: ${ourPos.kalshi_ticker}`, 'success');
        await addTradeLog({
          time: new Date().toLocaleTimeString(),
          event: 'Auto-closed (simulated)',
          market: 'Position closed',
          outcome: `${ourPos.side} → NO`,
          polyPrice: 'N/A',
          kalshiTicker: ourPos.kalshi_ticker,
          size: `${ourPos.count} contracts`,
          status: 'closed',
          pnl: null
        });
      }
      
      // Remove from our positions
      await removeOurPosition(ourPos.poly_condition_id);
    }
  }
}

module.exports = {
  findMatchingMarket,
  placeOrder,
  closePosition,
  processNewPosition,
  checkForClosedPositions
};
