const axios = require('axios');
const { upsertPosition, addActivityLog } = require('./database');

const POLYMARKET_DATA_API = process.env.POLYMARKET_DATA_API || 'https://data-api.polymarket.com';
const TRADER_ADDRESS = process.env.TRADER_ADDRESS || '0xfe787d2da716d60e8acff57fb87eb13cd4d10319';

/**
 * Fetch positions from Polymarket for a specific trader
 */
async function fetchPolymarketPositions() {
  try {
    const response = await axios.get(`${POLYMARKET_DATA_API}/positions`, {
      params: {
        user: TRADER_ADDRESS,
        limit: 100
      }
    });

    if (!response.data || !Array.isArray(response.data)) {
      addActivityLog('Polymarket API returned invalid data', 'warn');
      return [];
    }

    // DEBUG: Log first position to see actual API structure
    if (response.data.length > 0) {
      console.log('DEBUG Polymarket raw position:', JSON.stringify(response.data[0], null, 2));
    }

    const positions = response.data.map(pos => ({
      conditionId: pos.conditionId,
      title: pos.title || 'Unknown market',
      outcome: pos.outcome || 'YES',
      price: pos.curPrice || pos.avgPrice || 0,
      avgPrice: pos.avgPrice || 0,
      value: Math.round(pos.currentValue || pos.initialValue || 0),
      pnl: Math.round(pos.cashPnl || 0),
      pnlPct: pos.percentPnl || 0,
      shares: Math.round(pos.size || 0),
      category: 'Other',
      slug: pos.slug || '',
      redeemable: pos.redeemable || false
    }));

    addActivityLog(`Fetched ${positions.length} positions from Polymarket`, 'info');
    return positions;
  } catch (error) {
    addActivityLog(`Polymarket fetch error: ${error.message}`, 'error');
    console.error('Polymarket fetch error:', error);
    return [];
  }
}

/**
 * Update positions in database and return new positions
 */
async function updatePositions() {
  const positions = await fetchPolymarketPositions();
  
  if (positions.length === 0) {
    return [];
  }

  let newPositions = [];
  const existingPositions = await require('./database').getPositions();
  const existingIds = new Set(existingPositions.map(p => p.condition_id));

  for (const position of positions) {
    await upsertPosition(position);
    
    if (!existingIds.has(position.conditionId)) {
      newPositions.push(position);
    }
  }

  if (newPositions.length > 0) {
    await addActivityLog(`Detected ${newPositions.length} new positions`, 'trade');
  }

  return newPositions;
}

module.exports = {
  fetchPolymarketPositions,
  updatePositions
};
