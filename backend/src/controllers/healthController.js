import { getLiveStabilitySnapshot } from "../services/liveStabilityService.js";
import { logger } from "../utils/logger.js";
import { getRawMessages } from "../services/rawMessageStore.js";
import { getParsedSignals } from "../services/parsedSignalStore.js";

// controllers contain request handlers.
// Keeping handlers here prevents route files from growing too large.
export function getHealth(_request, response) {
  response.json({
    status: "Backend running",
  });
}

export function getLiveStability(_request, response) {
  logger.debug("api.live_stability_requested");

  response.json({
    stability: getLiveStabilitySnapshot(),
  });
}

export async function getDebugSignals(_request, response) {
  try {
    const raw = await getRawMessages(5);
    const parsed = await getParsedSignals(5);
    response.json({ raw, parsed });
  } catch (err) {
    response.status(500).json({ error: err.message });
  }
}

import { getCurrentPrice } from "../services/priceIngestionService.js";
export async function getDebugBinance(_request, response) {
  const details = {};
  try {
    const start = Date.now();
    details.price = await getCurrentPrice("BTCUSD");
    details.latency = Date.now() - start;
  } catch (err) {
    details.priceError = { message: err.message, stack: err.stack };
  }

  try {
    const directStart = Date.now();
    const res = await fetch("https://api.binance.com/api/v3/ticker/bookTicker?symbol=BTCUSDT");
    details.directFetch = {
      status: res.status,
      statusText: res.statusText,
      latency: Date.now() - directStart,
    };
    if (res.ok) {
      details.directFetch.data = await res.json();
    } else {
      details.directFetch.text = await res.text();
    }
  } catch (err) {
    details.directFetchError = { message: err.message, stack: err.stack };
  }

  response.json(details);
}

