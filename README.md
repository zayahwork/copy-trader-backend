# Copy Trader Backend

24/7 Polymarket to Kalshi copy trading service with automatic polling and trade execution.

## Features

- **Automatic polling**: Checks Polymarket for new positions every 30 seconds
- **Kalshi integration**: Automatically finds matching markets and executes trades
- **Persistent storage**: SQLite database for positions, logs, and settings
- **REST API**: Full API for frontend integration
- **Configurable settings**: Adjust copy size, max per trade, price edge, etc.
- **Activity logging**: Real-time activity and trade logs

## Quick Start

### Local Development

1. **Install dependencies**
```bash
npm install
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your API keys and settings
```

3. **Initialize database**
```bash
npm run init-db
```

4. **Start server**
```bash
npm run dev
```

The server will start on `http://localhost:3000`

### Production Deployment (Railway)

1. **Push to GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/copy-trader-backend.git
git push -u origin main
```

2. **Deploy to Railway**
- Go to [railway.app](https://railway.app)
- Click "New Project" → "Deploy from GitHub repo"
- Select your repository
- Railway will automatically detect Node.js and deploy

3. **Configure environment variables in Railway**
- Go to your project settings → Variables
- Add all variables from `.env.example`

4. **Persistent storage**
- Railway's filesystem is ephemeral
- For production, consider using Railway's PostgreSQL or add a volume mount

## API Endpoints

### GET /api/data
Get all data for the frontend (settings, positions, matches, logs)

### GET /api/settings
Get all settings

### POST /api/settings
Update a setting
```json
{
  "key": "copy_amount",
  "value": "50"
}
```

### GET /api/positions
Get all Polymarket positions

### GET /api/matches
Get all Kalshi market matches

### GET /api/trade-log
Get trade log (optional `?limit=50`)

### GET /api/activity-log
Get activity log (optional `?limit=50`)

### POST /api/toggle
Start/stop the copy trader

### POST /api/poll
Manually trigger a poll

### GET /health
Health check endpoint

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| NODE_ENV | Environment | production |
| TRADER_ADDRESS | Polymarket trader address | 0xfe787d2da716d60e8acff57fb87eb13cd4d10319 |
| TRADER_NAME | Polymarket trader name | ferrarichampions2026 |
| POLYMARKET_DATA_API | Polymarket API URL | https://data-api.polymarket.com |
| KALSHI_API_KEY_ID | Kalshi API key ID | - |
| KALSHI_API_KEY_SECRET | Kalshi API secret | - |
| KALSHI_API | Kalshi API URL | https://api.kalshi.co/v1 |
| COPY_AMOUNT | Copy size percentage | 100 |
| MAX_PER_TRADE | Maximum per trade | 250 |
| MIN_EDGE | Minimum price edge (cents) | 3 |
| AUTO_CLOSE | Auto-close positions | true |
| ANTHROPIC_API_KEY | Anthropic API for AI analysis | - |

## Database Schema

### settings
Key-value configuration storage

### positions
Polymarket positions with condition_id, title, outcome, price, value, pnl, etc.

### kalshi_matches
Kalshi market matches for Polymarket positions

### trade_log
History of copy trades executed

### activity_log
Real-time activity logging

## How It Works

1. **Scheduled polling** (every 30s): Fetches positions from Polymarket
2. **New position detection**: Compares against database to find new positions
3. **Kalshi matching**: Searches for equivalent Kalshi markets
4. **Trade execution**: Places orders if conditions are met (price edge, running state)
5. **Logging**: Records all activity and trades to database

## Frontend Integration

Update your React component to use the backend API:

```javascript
// Replace mock data with API calls
const fetchData = async () => {
  const res = await fetch('http://your-backend-url/api/data');
  const data = await res.json();
  setPositions(data.positions);
  setKalshiMatches(data.kalshiMatches);
  setCopyLog(data.tradeLog);
  setLiveLog(data.activityLog);
};

// Toggle start/stop
const toggleRunning = async () => {
  await fetch('http://your-backend-url/api/toggle', { method: 'POST' });
  fetchData();
};
```

## Monitoring

- Check `/health` endpoint for server status
- Review activity logs via `/api/activity-log`
- Monitor trade execution via `/api/trade-log`

## Security Notes

- Never commit `.env` file
- Use environment variables for all secrets
- Kalshi API keys should be kept secure
- Consider adding authentication for API endpoints in production

## Troubleshooting

**Database locked error**: SQLite uses WAL mode, but concurrent writes may still conflict. Consider PostgreSQL for high-traffic production use.

**Polymarket API errors**: The API may rate limit. The service includes error handling and will retry on next poll.

**Kalshi order failures**: Check that your API keys are valid and you have sufficient balance.

## License

MIT
