# Telegram Signal Consensus Backend

Beginner-friendly backend foundation for fetching Telegram messages, preparing forex signal parsing, building consensus logic, and exposing dashboard APIs.

## Folder Guide

- `src/config`: shared app configuration, database setup, and environment-backed settings.
- `src/services`: integrations and reusable business services, such as the GramJS Telegram client.
- `src/parsers`: future parsing modules for turning raw Telegram text into structured trade signals.
- `src/routes`: Express route definitions grouped by API area.
- `src/controllers`: request handlers that keep route files small and readable.
- `src/utils`: shared helpers such as loggers, validators, or formatting utilities.
- `server.js`: application entry point that loads env vars, connects services, and starts Express.

## Setup

1. Install backend dependencies:

   ```bash
   cd backend
   npm install
   ```

2. Update `.env` with your values.

3. Start MongoDB locally or use a MongoDB Atlas connection string.

4. Start the backend:

   ```bash
   npm run dev
   ```

5. Test the health route:

   ```bash
   GET http://localhost:5000/api/health
   ```

Expected response:

```json
{
  "status": "Backend running"
}
```

## Telegram Notes

Create Telegram API credentials at `https://my.telegram.org/apps`, then add `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` to `.env`.

Run a one-time login to save a reusable GramJS session:

```bash
npm run telegram:test
```

Then configure the background ingestion channels in one place:

```js
// src/config/telegramChannels.js
export const monitoredTelegramChannels = [
  { ref: "channel1", username: "channel1", title: "Channel 1" },
  { ref: "https://t.me/+privateInviteHash", username: null, title: "Private channel" },
];
```

Adding a channel should only require updating `src/config/telegramChannels.js`; no listener or parser code changes are needed.

When the backend starts, the Telegram listener runs inside the backend process and polls configured channels on `TELEGRAM_POLL_INTERVAL_MS`. This keeps signal collection running even when no frontend user is online. Frontend users should later read stored and processed results from backend APIs.

On startup, the listener validates each configured channel, logs whether it was found, joined, and accessible, samples recent messages for parser coverage stats, and emits a channel startup report with total, active, and inaccessible channel counts.

Verify stored raw messages:

```bash
GET http://localhost:5000/api/raw-messages
```

Verify parsed signal extraction:

```bash
GET http://localhost:5000/api/signals
```

The first parser layer is rules-based and built for messy Telegram content. It classifies messages as `NEW_SIGNAL`, `UPDATE_SIGNAL`, `RESULT_SIGNAL`, `PROMO`, `NEWS`, or `NOISE`. Actionable records extract pair/action/entry/targets/stop loss when available, keep missing fields as `null`, and store confidence, lifecycle, freshness, and parser warning metadata for review.

Run repeatable parser fixtures:

```bash
npm run parser:test
npm run parser:regression
```

Signal status uses `ACTIVE`, `PARTIAL`, `CLOSED`, `EXPIRED`, and `CANCELLED`. Parsed records also include dedupe, channel reliability, and update-linking foundation objects so consensus, duplicate clustering, and channel scoring can be added without reshaping the ingestion pipeline.

Parser changes must be regression-safe. `npm run parser:regression` compares the current parser against `test-messages/regression-baseline.json`, reports category accuracy before/after, extraction differences, and newly broken fixtures. Regenerate the baseline with `npm run parser:baseline` only after intentional fixture or parser-contract changes are reviewed.

Advanced noise filtering, signal parsing, consensus scoring, and dashboard APIs should be added in later steps.
