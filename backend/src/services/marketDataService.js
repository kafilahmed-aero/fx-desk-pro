import { getCachedPrice, setCachedPrice } from "./priceCacheService.js";
import { getBestProvider, reportSuccess, reportFailure } from "./providerRegistryService.js";
import { fetchPrices, resolveSymbol } from "./priceIngestionService.js";
import { logger } from "../utils/logger.js";

// Read-only diagnostics counters
let cacheHits = 0;
let cacheMisses = 0;
let providerRequests = 0;
let providerFailures = 0;
let failoverCount = 0;
let successfulFetches = 0;

/**
 * Deep freezes an object recursively to guarantee immutability
 * @param {Object} obj - Target object
 * @returns {Object} Frozen object
 */
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

/**
 * Orchestrates retrieval of a normalized market price snapshot
 * @param {string} pair - Normalized trading pair symbol
 * @param {Object} options - Override parameters (now, ttlMs)
 * @returns {Promise<Object>} Immutable market price result object
 */
export async function getMarketPrice(pair, options = {}) {
  const normalized = String(pair).toUpperCase().trim();
  const now = options.now || Date.now();
  const ttl = options.ttlMs || 60000;

  // 1. Attempt to read from Price Cache
  const cached = getCachedPrice(normalized, now);
  if (cached) {
    cacheHits++;
    return deepFreeze({
      status: "SUCCESS",
      source: cached.source,
      price: cached.price,
      bid: cached.bid,
      ask: cached.ask,
      lastUpdated: cached.lastUpdated
    });
  }

  cacheMisses++;

  // 2. Resolve candidate providers for the symbol
  const resolved = resolveSymbol(normalized);
  const candidateIds = [resolved.provider];
  if (resolved.provider === "binance") {
    candidateIds.push("yahoo"); // Fallback for crypto symbols
  }

  const attempted = new Set();

  while (true) {
    // 3. Prevent infinite provider loops & extract untried candidates
    const remaining = candidateIds.filter((id) => !attempted.has(id));
    if (remaining.length === 0) {
      break;
    }

    // 4. Query registry for best candidate (contact registry exactly once per attempt)
    const route = getBestProvider(remaining, now);
    if (!route) {
      break;
    }

    attempted.add(route.id);
    providerRequests++;

    try {
      // 5. Ingest fresh price
      const freshMap = await fetchPrices([normalized]);
      const freshPrice = freshMap.get(normalized);

      if (freshPrice && typeof freshPrice.price === "number") {
        // Success Path
        successfulFetches++;
        reportSuccess(route.id, now);
        setCachedPrice(normalized, freshPrice, ttl, now);

        return deepFreeze({
          status: "SUCCESS",
          source: freshPrice.source,
          price: freshPrice.price,
          bid: freshPrice.bid,
          ask: freshPrice.ask,
          lastUpdated: freshPrice.lastUpdated
        });
      } else {
        throw new Error("Invalid or empty price returned");
      }
    } catch (err) {
      // Failure Path
      providerFailures++;
      reportFailure(route.id, now);

      const nextRemaining = candidateIds.filter((id) => !attempted.has(id));
      if (nextRemaining.length > 0) {
        failoverCount++;
      }

      logger.warn("market_data.provider_fetch_failed", {
        pair: normalized,
        providerId: route.id,
        error: err.message
      });
    }
  }

  // 6. Fallback structured result when every provider fails
  return deepFreeze({
    status: "UNAVAILABLE",
    source: null,
    price: null,
    bid: null,
    ask: null,
    lastUpdated: null
  });
}

/**
 * Returns read-only diagnostics info
 * @returns {Object} Immutable diagnostics summary
 */
export function getDiagnostics() {
  return Object.freeze({
    cacheHits,
    cacheMisses,
    providerRequests,
    providerFailures,
    failoverCount,
    successfulFetches
  });
}

/**
 * Resets diagnostics counters (useful for unit testing)
 */
export function resetDiagnostics() {
  cacheHits = 0;
  cacheMisses = 0;
  providerRequests = 0;
  providerFailures = 0;
  failoverCount = 0;
  successfulFetches = 0;
}
