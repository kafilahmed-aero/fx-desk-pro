import mongoose from "mongoose";
import { MarketPrice } from "../models/marketPriceModel.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/env.js";
import { getBestProvider } from "./providerRegistryService.js";
import { EventEmitter } from "events";

export const priceEvents = new EventEmitter();

const CACHE_TTL_MS = 60000; // 1 minute
const priceCache = new Map(); // pair -> { price, bid, ask, lastUpdated }

export const priceHistoryCache = new Map(); // pair -> Array<{ price, timestamp }>

export function recordPriceHistory(pair, price) {
  const normalized = String(pair).toUpperCase().trim();
  if (!priceHistoryCache.has(normalized)) {
    priceHistoryCache.set(normalized, []);
  }
  const history = priceHistoryCache.get(normalized);
  history.push({ price, timestamp: Date.now() });

  // Keep only the configured hours of history
  const retentionHours = config.priceHistoryRetentionHours || 24;
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
  while (history.length > 0 && history[0].timestamp < cutoff) {
    history.shift();
  }
}

export function getPriceHistory(pair) {
  const normalized = String(pair).toUpperCase().trim();
  return priceHistoryCache.get(normalized) || [];
}

export function updatePriceCacheAndHistory(pair, priceInfo) {
  const normalized = String(pair).toUpperCase().trim();
  priceCache.set(normalized, priceInfo);
  recordPriceHistory(normalized, priceInfo.price);
}

const SYMBOL_MAP = {
  // Macro Indicators
  "DXY": { symbol: "DX-Y.NYB", provider: "yahoo" },
  "US10Y": { symbol: "^TNX", provider: "yahoo" },
  // Metals
  "XAUUSD": { symbol: "GC=F", provider: "yahoo" },
  "XAGUSD": { symbol: "SI=F", provider: "yahoo" },
  "GOLD": { symbol: "GC=F", provider: "yahoo" },
  "SILVER": { symbol: "SI=F", provider: "yahoo" },
  // Major Forex Pairs
  "EURUSD": { symbol: "EURUSD=X", provider: "yahoo" },
  "GBPUSD": { symbol: "GBPUSD=X", provider: "yahoo" },
  "GBPJPY": { symbol: "GBPJPY=X", provider: "yahoo" },
  "USDJPY": { symbol: "USDJPY=X", provider: "yahoo" },
  "AUDUSD": { symbol: "AUDUSD=X", provider: "yahoo" },
  "USDCAD": { symbol: "USDCAD=X", provider: "yahoo" },
  "USDCHF": { symbol: "USDCHF=X", provider: "yahoo" },
  "NZDUSD": { symbol: "NZDUSD=X", provider: "yahoo" },
  "EURGBP": { symbol: "EURGBP=X", provider: "yahoo" },
  "EURJPY": { symbol: "EURJPY=X", provider: "yahoo" },
  // Indices
  "US30": { symbol: "^DJI", provider: "yahoo" },
  "SPX500": { symbol: "^GSPC", provider: "yahoo" },
  "NAS100": { symbol: "^IXIC", provider: "yahoo" },
  "US100": { symbol: "^IXIC", provider: "yahoo" },
  "GER30": { symbol: "^GDAXI", provider: "yahoo" },
  "UK100": { symbol: "^FTSE", provider: "yahoo" },
  // Commodities
  "USOIL": { symbol: "CL=F", provider: "yahoo" },
  "WTI": { symbol: "CL=F", provider: "yahoo" },
  "UKOIL": { symbol: "BZ=F", provider: "yahoo" },
  "BRENT": { symbol: "BZ=F", provider: "yahoo" },
  "NATGAS": { symbol: "NG=F", provider: "yahoo" },
  // Stocks
  "TSLA": { symbol: "TSLA", provider: "yahoo" },
  "AAPL": { symbol: "AAPL", provider: "yahoo" },
  "MSFT": { symbol: "MSFT", provider: "yahoo" },
  "NVDA": { symbol: "NVDA", provider: "yahoo" },
  // Crypto (Default to Binance)
  "BTCUSD": { symbol: "BTCUSDT", provider: "binance" },
  "ETHUSD": { symbol: "ETHUSDT", provider: "binance" },
  "SOLUSD": { symbol: "SOLUSDT", provider: "binance" },
};

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Resolves a pair name to symbol and provider details
 * @param {string} pair - Normalized pair name
 * @returns {Object} { symbol, provider }
 */
export function resolveSymbol(pair) {
  const normalized = String(pair).toUpperCase().replace(/[^A-Z0-9^=]/g, "");
  if (SYMBOL_MAP[normalized]) {
    return SYMBOL_MAP[normalized];
  }

  // Fallback heuristics:
  // If it's a crypto pair style (like BTCUSD or ETHUSD) not in map
  if (normalized.endsWith("USD") && (normalized.startsWith("BTC") || normalized.startsWith("ETH") || normalized.length > 6)) {
    return { symbol: `${normalized}T`, provider: "binance" }; // e.g. LTCUSDT
  }
  
  // Standard Forex (6 letters)
  if (normalized.length === 6) {
    return { symbol: `${normalized}=X`, provider: "yahoo" };
  }

  // Default to yahoo
  return { symbol: normalized, provider: "yahoo" };
}

export async function fetchWithRetry(url, options = {}, retries = 2, delay = 500) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      if (i === retries) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (err) {
      if (i === retries) {
        throw err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
  }
}

const providers = {
  yahoo: {
    async fetchPrice(symbol) {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
      const response = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const json = await response.json();
      const meta = json?.chart?.result?.[0]?.meta;
      const result = json?.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const closes = result?.indicators?.quote?.[0]?.close || [];

      if (!meta || meta.regularMarketPrice === undefined) {
        throw new Error("regularMarketPrice missing in Yahoo meta");
      }

      return {
        price: Number(meta.regularMarketPrice),
        bid: Number(meta.regularMarketPrice),
        ask: Number(meta.regularMarketPrice),
        lastUpdated: new Date(),
        source: "YAHOO",
        timestamps,
        closes
      };
    }
  },
  binance: {
    async fetchPrice(symbol) {
      const url = `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`;
      const response = await fetchWithRetry(url);
      const ticker = await response.json();
      const bid = Number(ticker.bidPrice);
      const ask = Number(ticker.askPrice);
      const price = (bid + ask) / 2;

      return {
        price,
        bid,
        ask,
        lastUpdated: new Date(),
        source: "BINANCE"
      };
    }
  }
};

/**
 * Fetches prices for a set of pairs from their respective providers and updates cache & DB
 * @param {Array<string>} pairs - Array of normalized pair names
 * @returns {Promise<Map<string, Object>>} Map of pair -> price info
 */
export async function fetchPrices(pairs) {
  const results = new Map();
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return results;
  }

  const yahooPairs = [];
  const binancePairs = [];

  // Categorize pairs using the Provider Registry
  pairs.forEach((pair) => {
    const resolved = resolveSymbol(pair);
    const candidates = [resolved.provider];
    if (resolved.provider === "binance") {
      candidates.push("yahoo");
    }
    const best = getBestProvider(candidates);
    const providerId = best ? best.id : resolved.provider;

    if (providerId === "binance") {
      binancePairs.push({ pair, symbol: resolved.symbol });
    } else {
      let symbol = resolved.symbol;
      if (resolved.provider === "binance" && providerId === "yahoo") {
        symbol = pair.replace("USD", "-USD");
      }
      yahooPairs.push({ pair, symbol });
    }
  });

  // Fetch Yahoo Prices in parallel
  if (yahooPairs.length > 0) {
    try {
      const promises = yahooPairs.map(async (item) => {
        try {
          const data = await providers.yahoo.fetchPrice(item.symbol);
          const priceInfo = Object.freeze({
            price: data.price,
            bid: data.bid,
            ask: data.ask,
            lastUpdated: data.lastUpdated,
            source: data.source,
          });
          results.set(item.pair, priceInfo);
          updatePriceCacheAndHistory(item.pair, priceInfo);
          saveMarketPriceToDB(item.pair, item.symbol, priceInfo).catch(() => {});

          if (data.timestamps.length > 0 && data.closes.length > 0) {
            const history = [];
            for (let idx = 0; idx < data.timestamps.length; idx++) {
              const p = data.closes[idx];
              if (p !== null && p !== undefined && !Number.isNaN(p)) {
                history.push({ price: p, timestamp: data.timestamps[idx] * 1000 });
              }
            }
            const retentionHours = config.priceHistoryRetentionHours || 24;
            const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
            priceHistoryCache.set(item.pair, history.filter(h => h.timestamp >= cutoff));
          }
        } catch (err) {
          logger.error("price_ingestion.yahoo_fetch_item_failed", { symbol: item.symbol, error: err.message });
        }
      });
      await Promise.all(promises);
    } catch (err) {
      logger.error("price_ingestion.yahoo_failed", { error: err.message });
    }
  }

  // Fetch Binance Prices sequentially
  if (binancePairs.length > 0) {
    for (const item of binancePairs) {
      let fetchedOk = false;
      try {
        const data = await providers.binance.fetchPrice(item.symbol);
        const priceInfo = Object.freeze({
          price: data.price,
          bid: data.bid,
          ask: data.ask,
          lastUpdated: data.lastUpdated,
          source: data.source,
        });
        results.set(item.pair, priceInfo);
        updatePriceCacheAndHistory(item.pair, priceInfo);
        saveMarketPriceToDB(item.pair, item.symbol, priceInfo).catch(() => {});
        fetchedOk = true;
      } catch (err) {
        logger.error("price_ingestion.binance_failed", { symbol: item.symbol, error: err.message });
      }

      // Fallback to Yahoo Finance for crypto if Binance fails
      if (!fetchedOk) {
        try {
          const yahooCryptoSymbol = item.pair.replace("USD", "-USD");
          logger.info("price_ingestion.binance_fallback_to_yahoo", { pair: item.pair, yahooSymbol: yahooCryptoSymbol });
          const data = await providers.yahoo.fetchPrice(yahooCryptoSymbol);
          const priceInfo = Object.freeze({
            price: data.price,
            bid: data.bid,
            ask: data.ask,
            lastUpdated: data.lastUpdated,
            source: "YAHOO_FALLBACK",
          });
          results.set(item.pair, priceInfo);
          updatePriceCacheAndHistory(item.pair, priceInfo);
          saveMarketPriceToDB(item.pair, item.symbol, priceInfo).catch(() => {});

          if (data.timestamps.length > 0 && data.closes.length > 0) {
            const history = [];
            for (let idx = 0; idx < data.timestamps.length; idx++) {
              const p = data.closes[idx];
              if (p !== null && p !== undefined && !Number.isNaN(p)) {
                history.push({ price: p, timestamp: data.timestamps[idx] * 1000 });
              }
            }
            const cutoff = Date.now() - 65 * 60 * 1000;
            priceHistoryCache.set(item.pair, history.filter(h => h.timestamp >= cutoff));
          }
        } catch (yahooErr) {
          logger.error("price_ingestion.binance_yahoo_fallback_failed", { pair: item.pair, error: yahooErr.message });
        }
      }
    }
  }

  const xauusdPrice = results.get("XAUUSD");
  if (xauusdPrice && typeof xauusdPrice.price === "number") {
    import("./aiRecommendationStateService.js").then((mod) => {
      mod.generateRecommendationIfNeeded("PRICE_CHANGE", xauusdPrice.price).catch(() => {});
    }).catch(() => {});
  }

  priceEvents.emit("pricesUpdated", results);

  return results;
}

/**
 * Gets the current price for a specific pair, using cache or fetching if stale
 * @param {string} pair - Normalized pair name
 * @returns {Promise<Object|null>} Price info or null if unavailable
 */
export async function getCurrentPrice(pair) {
  const normalized = String(pair).toUpperCase().trim();
  
  // 1. Check in-memory cache
  const cached = priceCache.get(normalized);
  if (cached && (Date.now() - new Date(cached.lastUpdated).getTime() < CACHE_TTL_MS)) {
    return Object.freeze({ ...cached });
  }

  // 2. Fetch fresh price
  try {
    const fetched = await fetchPrices([normalized]);
    const priceInfo = fetched.get(normalized);
    if (priceInfo) {
      return Object.freeze({ ...priceInfo });
    }
  } catch (err) {
    logger.error("price_ingestion.get_current_price_fetch_failed", { pair: normalized, error: err.message });
  }

  // 3. Fallback to cache (even if expired)
  if (cached) {
    return Object.freeze({ ...cached });
  }

  // 4. Fallback to MongoDB
  if (isMongoConnected()) {
    try {
      const stored = await MarketPrice.findById(normalized).lean();
      if (stored) {
        const priceInfo = Object.freeze({
          price: stored.price,
          bid: stored.bid || stored.price,
          ask: stored.ask || stored.price,
          lastUpdated: stored.lastUpdated,
          source: stored.source || "UNKNOWN",
        });
        // Re-hydrate cache
        updatePriceCacheAndHistory(normalized, priceInfo);
        return priceInfo;
      }
    } catch (dbErr) {
      logger.error("price_ingestion.db_fallback_failed", { pair: normalized, error: dbErr.message });
    }
  }

  return null;
}

/**
 * Persists the latest price document to MongoDB
 */
async function saveMarketPriceToDB(pair, symbol, priceInfo) {
  if (!isMongoConnected()) {
    return;
  }
  try {
    await MarketPrice.findByIdAndUpdate(
      pair,
      {
        $set: {
          pair,
          symbol,
          price: priceInfo.price,
          bid: priceInfo.bid,
          ask: priceInfo.ask,
          lastUpdated: priceInfo.lastUpdated,
          source: priceInfo.source || "UNKNOWN",
        },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    logger.error("price_ingestion.save_db_failed", { pair, error: err.message });
  }
}

/**
 * Resets the in-memory price cache (useful for testing)
 */
export function resetPriceCache() {
  priceCache.clear();
}
