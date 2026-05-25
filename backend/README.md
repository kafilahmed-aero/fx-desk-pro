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

This foundation prepares the GramJS client but does not fetch messages yet. Advanced logic for Telegram fetching, noise filtering, signal parsing, consensus scoring, and dashboard APIs should be added in later steps.
