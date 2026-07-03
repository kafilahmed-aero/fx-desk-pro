import mongoose from "mongoose";
import { MarketPrice } from "../models/marketPriceModel.js";
import { logger } from "../utils/logger.js";

const CACHE_TTL_MS = 60000; // 1 minute
const priceCache = new Map(); // pair -> { price, bid, ask, lastUpdated }

const SYMBOL_MAP = {
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

  // Categorize pairs
  pairs.forEach((pair) => {
    const resolved = resolveSymbol(pair);
    if (resolved.provider === "binance") {
      binancePairs.push({ pair, symbol: resolved.symbol });
    } else {
      yahooPairs.push({ pair, symbol: resolved.symbol });
    }
  });

  // Fetch Yahoo Prices in parallel using v8 chart endpoint
  if (yahooPairs.length > 0) {
    try {
      const promises = yahooPairs.map(async (item) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${item.symbol}?interval=1m&range=1d`;
          const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
          if (response.ok) {
            const json = await response.json();
            const meta = json?.chart?.result?.[0]?.meta;
            if (meta && meta.regularMarketPrice !== undefined) {
              const price = Number(meta.regularMarketPrice);
              const priceInfo = {
                price,
                bid: price,
                ask: price,
                lastUpdated: new Date(),
              };
              results.set(item.pair, priceInfo);
              priceCache.set(item.pair, priceInfo);
              saveMarketPriceToDB(item.pair, item.symbol, priceInfo).catch(() => {});
            } else {
              logger.warn("price_ingestion.yahoo_meta_missing", { symbol: item.symbol });
            }
          } else {
            logger.warn("price_ingestion.yahoo_failed_http", { symbol: item.symbol, status: response.status });
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

  // Fetch Binance Prices sequentially (usually crypto is limited to BTC and ETH in signals)
  if (binancePairs.length > 0) {
    for (const item of binancePairs) {
      let fetchedOk = false;
      try {
        const url = `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${item.symbol}`;
        const response = await fetch(url);
        if (response.ok) {
          const ticker = await response.json();
          const bid = Number(ticker.bidPrice);
          const ask = Number(ticker.askPrice);
          const price = (bid + ask) / 2;

          const priceInfo = {
            price,
            bid,
            ask,
            lastUpdated: new Date(),
          };
          results.set(item.pair, priceInfo);
          priceCache.set(item.pair, priceInfo);
          saveMarketPriceToDB(item.pair, item.symbol, priceInfo).catch(() => {});
          fetchedOk = true;
        } else {
          logger.warn("price_ingestion.binance_failed_http", { symbol: item.symbol, status: response.status });
        }
      } catch (err) {
        logger.error("price_ingestion.binance_failed", { symbol: item.symbol, error: err.message });
      }

      // Fallback to Yahoo Finance for crypto (e.g. BTCUSD -> BTC-USD) if Binance fails
      if (!fetchedOk) {
        try {
          const yahooCryptoSymbol = item.pair.replace("USD", "-USD");
          logger.info("price_ingestion.binance_fallback_to_yahoo", { pair: item.pair, yahooSymbol: yahooCryptoSymbol });
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooCryptoSymbol}?interval=1m&range=1d`;
          const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
          if (response.ok) {
            const json = await response.json();
            const meta = json?.chart?.result?.[0]?.meta;
            if (meta && meta.regularMarketPrice !== undefined) {
              const price = Number(meta.regularMarketPrice);
              const priceInfo = {
                price,
                bid: price,
                ask: price,
                lastUpdated: new Date(),
              };
              results.set(item.pair, priceInfo);
              priceCache.set(item.pair, priceInfo);
              saveMarketPriceToDB(item.pair, item.symbol, priceInfo).catch(() => {});
            }
          }
        } catch (yahooErr) {
          logger.error("price_ingestion.binance_yahoo_fallback_failed", { pair: item.pair, error: yahooErr.message });
        }
      }
    }
  }

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
    return cached;
  }

  // 2. Fetch fresh price
  try {
    const fetched = await fetchPrices([normalized]);
    const priceInfo = fetched.get(normalized);
    if (priceInfo) {
      return priceInfo;
    }
  } catch (err) {
    logger.error("price_ingestion.get_current_price_fetch_failed", { pair: normalized, error: err.message });
  }

  // 3. Fallback to cache (even if expired)
  if (cached) {
    return cached;
  }

  // 4. Fallback to MongoDB
  if (isMongoConnected()) {
    try {
      const stored = await MarketPrice.findById(normalized).lean();
      if (stored) {
        const priceInfo = {
          price: stored.price,
          bid: stored.bid || stored.price,
          ask: stored.ask || stored.price,
          lastUpdated: stored.lastUpdated,
        };
        // Re-hydrate cache
        priceCache.set(normalized, priceInfo);
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
