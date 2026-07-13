# FX Desk Pro — Demo Testing Lessons Learned

This document provides a detailed breakdown of the challenges, edge cases, and architectural fixes identified during the live E2E autonomous demo testing.

---

## A. Weekend & Off-Market Testing
- **TimeCurrent() Freeze**: MetaTrader's `TimeCurrent()` function returns the time of the last received quote. During weekends or market close periods, no quotes are received, causing the timestamp to remain static. The EA's polling schedules must rely on local machine system time (`TimeLocal()`) for timing logic rather than trade server time when checking reconnection windows.
- **EA Reconnect Limitation**: When the node backend bridge is restarted, the EA's socket connection attempts to reconnect immediately. However, if the connection is refused, it triggers a backoff timer. To prevent connection starvation, a steady reconnection loop of 5–10 seconds was verified as stable, avoiding socket blocking on the terminal chart thread.

---

## B. Database Offline Handlers
- **REGISTER Bypass**: During start-up, the MT5 EA registers with the bridge. If the MongoDB backend is offline or slow, the registration queries would block, causing socket timeouts. A database bypass was implemented allowing the bridge to successfully register the socket client session in memory even if the database state is temporarily unavailable.
- **PONG Bypass**: Similarly, telemetry packets (PONG / heartbeat acknowledgments) are stored in raw message logs. In database-free fallback mode, logging is routed strictly to standard console/file streams to ensure network execution remains non-blocking.

---

## C. Heartbeat & Connection Keep-Alive
- **Missing PONG Handler**: The initial bridge implementation sent `PING` packets to the EA but failed to correctly bind the incoming parser to capture the EA's `PONG` response payload. This resulted in false-positive heartbeat timeout disconnects every 30 seconds.
- **Heartbeat Timeout Root Cause**: Node's event loop latency combined with MQL5's network socket buffer delays meant that heartbeat queries could overlap. The interval was increased to 10 seconds, and the parsing routine was updated to cleanly slice incoming TCP frames and extract binary/text flags to reset the client timeout timer.

---

## D. Telegram Ingestion Rate Limits
- **FloodWait Invite Issue**: When restarting the backend server during debugging, the Telegram client attempted to join the channel feed using the `ImportChatInvite` API call on every launch. This repeatedly triggered Telegram's strict anti-spam rate limits, leading to `FLOOD_WAIT` exceptions forcing an 800+ second wait.
- **CheckChatInvite Fix**: Modified the startup sequence in `telegramService.js` to call `CheckChatInvite` first to inspect the link. If the client is already a member of the target channel, the service skips the join request completely, preventing Flood limits from triggering.

---

## E. Broker Execution & Price Deviations
- **Invalid Stops & Tight SL Rejection**: Broker execution requests will fail with MT5 Retcode `10016` (Invalid Stops) if the Stop Loss (SL) or Take Profit (TP) are placed inside the broker's minimum stop level limit (StopLevel). During early runs, tight stops (e.g. 5–10 pips) were rejected.
- **Spread Differences**: Prices fetched from Yahoo Finance (`GC=F` for XAUUSD) can differ by several points from the broker's live bid/ask quotes. If the execution price calculations use Yahoo's price while the broker executes at their quote, the stops can inadvertently breach the StopLevel limit.
- **Broker Validation Rules**: Future updates must read the broker's actual spread and minimum StopLevel from the EA's `ACCOUNT_SUMMARY` payload dynamically before setting orders.

---

## F. MT5 Execution Rejections
- **First TRADE_FAILED**: The initial E2E autonomous order dispatch failed with trade transaction code `10016` (Invalid Stops).
- **Root Cause**: The SL calculation placed the stop price within the broker's spread limit due to the Yahoo Finance price discrepancy.
- **Fix**: Implemented a wider stop bounds policy during E2E verification to verify the pipes safely (e.g., placing SL at `3813.10` and TP at `4413.10` for an entry of `4014.09`).
- **Verification**: The subsequent run executed successfully, demonstrating the execution path was functional and correct.

---

## G. First Successful Real Demo Trade
- **Ticket ID**: `57509274119`
- **Asset / Symbol**: XAUUSD (Gold)
- **Order Type**: BUY Market Order
- **Volume**: 0.01 lot
- **Entry Price**: `4014.09`
- **Exit Price**: `4007.13` (Manual Close)
- **Execution Log**:
  - `2026.07.13 17:31:43`: Position Opened.
  - `2026.07.13 17:37:49`: Position Closed.
- **Key Lessons Learned**:
  1. **Broker Sync**: Adaptive slippage tolerances should be calculated based on the broker's live spread rather than static third-party APIs.
  2. **Telemetric Loop**: The socket connection must remain non-blocking so that price movements during order execution do not disrupt state synchronization.
