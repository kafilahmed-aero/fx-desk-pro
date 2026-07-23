import { getCachedPrice, setCachedPrice } from "./priceCacheService.js";
import { fetchPrices } from "./priceIngestionService.js";
import { logger } from "../utils/logger.js";

// Read-only diagnostics counters
let cacheHits = 0;
let cacheMisses = 0;
let providerRequests = 0;
let providerFailures = 0;
let successfulFetches = 0;

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  Object.keys(obj).forEach((key) => {
    deepFreeze(obj[key]);
  });
  return obj;
}

export async function getMarketPrice(pair, options = {}) {
  const normalized = String(pair).toUpperCase().trim();
  const now = options.now || Date.now();
  const ttl = options.ttlMs || 60000;

  // 1. Read from Price Cache
  const cached = getCachedPrice(normalized, now);
  if (cached) {
    cacheHits++;
    return deepFreeze({
      status: "SUCCESS",
      source: cached.source,
      price: cached.price,
      bid: cached.bid,
      ask: cached.ask,
      lastUpdated: cached.lastUpdated,
    });
  }

  cacheMisses++;
  providerRequests++;

  try {
    const freshMap = await fetchPrices([normalized]);
    const freshPrice = freshMap.get(normalized);

    if (freshPrice && typeof freshPrice.price === "number") {
      successfulFetches++;
      setCachedPrice(normalized, freshPrice, ttl, now);

      return deepFreeze({
        status: "SUCCESS",
        source: freshPrice.source,
        price: freshPrice.price,
        bid: freshPrice.bid,
        ask: freshPrice.ask,
        lastUpdated: freshPrice.lastUpdated,
      });
    }
  } catch (err) {
    providerFailures++;
    logger.warn("market_data.fetch_failed", {
      pair: normalized,
      error: err.message,
    });
  }

  return deepFreeze({
    status: "UNAVAILABLE",
    source: null,
    price: null,
    bid: null,
    ask: null,
    lastUpdated: null,
  });
}

export function getDiagnostics() {
  return Object.freeze({
    cacheHits,
    cacheMisses,
    providerRequests,
    providerFailures,
    successfulFetches,
  });
}

export function resetDiagnostics() {
  cacheHits = 0;
  cacheMisses = 0;
  providerRequests = 0;
  providerFailures = 0;
  successfulFetches = 0;
}
