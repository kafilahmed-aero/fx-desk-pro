import { logger } from "../utils/logger.js";

const DEFAULT_TTL_MS = 60000; // 1 minute default

// Internal maps for isolation
const cacheMap = new Map(); // pair -> public snapshot
const metadataMap = new Map(); // pair -> internal metadata

// Diagnostics counters
let totalHits = 0;
let totalMisses = 0;
let staleReadsCount = 0;
let lastWriteTimeStr = null;

/**
 * Deep freezes an object recursively
 * @param {Object} obj - Target object
 * @returns {Object} Frozen object
 */
export function deepFreeze(obj) {
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
 * Saves a price snapshot in the cache atomically
 * @param {string} pair - Normalized pair name
 * @param {Object} priceInfo - Price object to cache
 * @param {number} ttlMs - Cache TTL in milliseconds
 * @param {number} now - Optional timestamp for testing
 */
export function setCachedPrice(pair, priceInfo, ttlMs = DEFAULT_TTL_MS, now = Date.now()) {
  if (!pair || !priceInfo || typeof priceInfo.price !== "number") {
    logger.warn("price_cache.invalid_payload_skipped", { pair });
    return;
  }

  const normalized = String(pair).toUpperCase().trim();
  
  // Clone to prevent external mutations and deep freeze
  const cloned = JSON.parse(JSON.stringify(priceInfo));
  cloned.lastUpdated = priceInfo.lastUpdated ? new Date(priceInfo.lastUpdated).toISOString() : new Date(now).toISOString();
  const frozen = deepFreeze(cloned);

  // Atomic write to maps
  cacheMap.set(normalized, frozen);
  metadataMap.set(normalized, {
    cachedAt: now,
    expiresAt: now + ttlMs,
    ttlMs,
    hits: 0,
    misses: 0
  });

  lastWriteTimeStr = new Date(now).toISOString();
  logger.debug("price_cache.entry_updated", { pair: normalized, price: frozen.price });
}

/**
 * Reads a healthy (non-expired) price snapshot from the cache
 * @param {string} pair - Normalized pair name
 * @param {number} now - Optional timestamp for testing
 * @returns {Object|null} Immutable frozen price snapshot or null
 */
export function getCachedPrice(pair, now = Date.now()) {
  const normalized = String(pair).toUpperCase().trim();
  const cached = cacheMap.get(normalized);
  const meta = metadataMap.get(normalized);

  if (!cached || !meta) {
    totalMisses++;
    return null;
  }

  if (now > meta.expiresAt) {
    staleReadsCount++;
    totalMisses++;
    meta.misses++;
    return null;
  }

  totalHits++;
  meta.hits++;
  return cached;
}

/**
 * Checks if a cached pair's value is stale/expired
 * @param {string} pair - Normalized pair name
 * @param {number} now - Optional timestamp for testing
 * @returns {boolean} True if stale or missing, false if healthy
 */
export function isCacheStale(pair, now = Date.now()) {
  const normalized = String(pair).toUpperCase().trim();
  const meta = metadataMap.get(normalized);
  if (!meta) return true;
  return now > meta.expiresAt;
}

/**
 * Clears all cache entries and resets diagnostics
 */
export function resetCache() {
  cacheMap.clear();
  metadataMap.clear();
  totalHits = 0;
  totalMisses = 0;
  staleReadsCount = 0;
  lastWriteTimeStr = null;
  logger.info("price_cache.reset_complete");
}

/**
 * Returns read-only cache diagnostics
 * @returns {Object} Immutable diagnostics summary
 */
export function getDiagnostics() {
  return Object.freeze({
    totalEntries: cacheMap.size,
    cacheHits: totalHits,
    cacheMisses: totalMisses,
    staleReads: staleReadsCount,
    lastWriteTime: lastWriteTimeStr
  });
}
