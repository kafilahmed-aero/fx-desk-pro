import { logger } from "../utils/logger.js";

export const RECOGNIZED_ASSETS = new Set([
  "XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY",
  "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "BTCUSD",
  "ETHUSD", "SOLUSD", "US30", "US100", "SPX500",
  "GER40", "WTI", "BRENT", "NATGAS", "DXY"
]);

const aliasMap = new Map([
  // DXY Index
  ["DXY", "DXY"],

  // Metals
  ["GOLD", "XAUUSD"],
  ["XAUUSD", "XAUUSD"],
  ["XAUSSD", "XAUUSD"],
  ["XAU/USD", "XAUUSD"],
  ["GOLD SPOT", "XAUUSD"],
  ["XAU", "XAUUSD"],
  ["SILVER", "XAGUSD"],
  ["XAGUSD", "XAGUSD"],
  ["XAG/USD", "XAGUSD"],
  ["SILVER SPOT", "XAGUSD"],
  ["XAG", "XAGUSD"],

  // Indices
  ["US30", "US30"],
  ["DJ30", "US30"],
  ["DOW", "US30"],
  ["DOW JONES", "US30"],
  ["WALL STREET", "US30"],
  ["US100", "US100"],
  ["NAS100", "US100"],
  ["NASDAQ", "US100"],
  ["NASDAQ100", "US100"],
  ["USTEC", "US100"],
  ["SP500", "SPX500"],
  ["SPX500", "SPX500"],
  ["S&P500", "SPX500"],
  ["US500", "SPX500"],
  ["S&P 500", "SPX500"],
  ["GER40", "GER40"],
  ["DAX", "GER40"],
  ["DAX40", "GER40"],
  ["UK100", "UK100"],
  ["FTSE", "UK100"],
  ["FTSE100", "UK100"],
  ["JP225", "JP225"],
  ["NIKKEI", "JP225"],

  // Commodities
  ["NATGAS", "NATGAS"],
  ["NATURAL GAS", "NATGAS"],
  ["WTI", "WTI"],
  ["USOIL", "WTI"],
  ["CRUDE OIL", "WTI"],
  ["BRENT", "BRENT"],
  ["UKOIL", "BRENT"],
  ["BRENT OIL", "BRENT"],

  // Crypto
  ["BTC", "BTCUSD"],
  ["BTCUSD", "BTCUSD"],
  ["BTCUSDT", "BTCUSD"],
  ["BITCOIN", "BTCUSD"],
  ["ETH", "ETHUSD"],
  ["ETHUSD", "ETHUSD"],
  ["ETHUSDT", "ETHUSD"],
  ["ETHEREUM", "ETHUSD"],
  ["SOL", "SOLUSD"],
  ["SOLUSD", "SOLUSD"],
  ["SOLUSDT", "SOLUSD"],
  ["XRP", "XRPUSD"],
  ["XRPUSD", "XRPUSD"],
  ["XRPUSDT", "XRPUSD"],
  ["DOGE", "DOGEUSD"],
  ["DOGEUSD", "DOGEUSD"],
  ["DOGEUSDT", "DOGEUSD"],
  ["ADA", "ADAUSD"],
  ["ADAUSD", "ADAUSD"],
  ["ADAUSDT", "ADAUSD"],
  ["AVAX", "AVAXUSD"],
  ["AVAXUSD", "AVAXUSD"],
  ["AVAXUSDT", "AVAXUSD"],
  ["BNB", "BNBUSD"],
  ["BNBUSD", "BNBUSD"],
  ["BNBUSDT", "BNBUSD"],
  ["LINK", "LINKUSD"],
  ["LINKUSD", "LINKUSD"],
  ["LINKUSDT", "LINKUSD"],

  // Stocks
  ["APPLE", "AAPL"],
  ["AAPL", "AAPL"],
  ["TESLA", "TSLA"],
  ["TSLA", "TSLA"],
  ["NVIDIA", "NVDA"],
  ["NVDA", "NVDA"],
  ["MICROSOFT", "MSFT"],
  ["MSFT", "MSFT"],
  ["AMAZON", "AMZN"],
  ["AMZN", "AMZN"],
  ["GOOGLE", "GOOGL"],
  ["ALPHABET", "GOOGL"],
  ["GOOGL", "GOOGL"],
  ["META", "META"],
  ["FACEBOOK", "META"],
  ["NETFLIX", "NFLX"],
  ["NFLX", "NFLX"],
  ["AMD", "AMD"],
  ["PALANTIR", "PLTR"],
  ["PLTR", "PLTR"],
  ["INTEL", "INTC"],
  ["INTC", "INTC"],
  ["UBER", "UBER"],
  ["COINBASE", "COIN"],
  ["COIN", "COIN"],
  ["SHOPIFY", "SHOP"],
  ["SHOP", "SHOP"],
  ["PAYPAL", "PYPL"],
  ["PYPL", "PYPL"],

  // ETFs/Other assets
  ["QQQ", "QQQ"],
]);

const currencyCodes = new Set([
  "AUD",
  "CAD",
  "CHF",
  "CNH",
  "EUR",
  "GBP",
  "HKD",
  "JPY",
  "MXN",
  "NOK",
  "NZD",
  "SEK",
  "SGD",
  "USD",
  "ZAR",
]);

const ignoredIndexLikeTokens = new Set(["TP1", "TP2", "TP3", "TP4", "TP5", "TP6", "TP7", "TP8", "TP9"]);

const ignoredPairWords = new Set([
  "LIMIT",
  "STOP",
  "NOW",
  "ZONE",
  "PRICE",
  "MARKET",
  "CMP",
  "AT",
  "FROM",
  "OR",
  "TO",
  "AND",
  "THE",
  "FOR",
  "THIS",
  "VIP",
  "ENTRY",
  "ENTRIES",
  "TARGET",
  "TARGETS",
  "STOPLOSS",
  "STOP LOSS",
  "SL",
  "TP",
  "TAKE",
  "PROFIT",
  "DAILY",
  "WEEKLY",
  "TIMEFRAME",
  "TF",
  "BIAS",
  "BULLISH",
  "BEARISH",
  "GOAL",
  "LEVEL",
  "POINT",
  "PIVOT",
  "ERS",
  "ING",
]);

export function isValidPairCandidate(candidate) {
  if (!candidate) return false;
  const cleaned = candidate.toUpperCase().replace(/#/g, "").replace(/\//g, "").trim();
  if (cleaned.length < 3 || cleaned.length > 12) return false;
  if (ignoredPairWords.has(cleaned)) return false;
  const prefix = cleaned.replace(/\d+$/, "");
  if (ignoredPairWords.has(prefix)) return false;
  if (cleaned.endsWith("ERS") || cleaned.endsWith("ING")) return false;
  if (["BUY", "SELL", "LONG", "SHORT"].includes(cleaned)) return false;
  if (/^[0-9.‐–——-\s]+$/.test(cleaned)) return false;
  return true;
}

export function cleanTextForPairDetection(text = "") {
  if (!text) return "";

  // Normalize (XAU/USD) to XAUUSD before other processing
  let processedText = text.replace(/\(([A-Z]{3})\s*[/]\s*([A-Z]{3})\)/gi, "$1$2");
  if (text.includes("\n")) {
    const lines = text.split(/\r?\n/);
    const urlPattern = /(?:https?:\/\/|www\.|t\.me)/i;
    const telegramHandlePattern = /@\s*[a-zA-Z_][a-zA-Z0-9_]*/;
    const promoKeywordsPattern = /\b(?:deposit|register|referral|signup|sign-up|join|contact|free vip|promo|advertisement|broker)\b/i;

    const cleanLines = lines.filter((line) => {
      const isPromo = urlPattern.test(line) || 
                      telegramHandlePattern.test(line) || 
                      promoKeywordsPattern.test(line);
      return !isPromo;
    });
    processedText = cleanLines.join("\n");
  }

  // 2. Also strip individual URLs, Telegram handles, and common promo phrases inline
  // to handle cases where newlines are already flattened or within remaining lines
  processedText = processedText
    .replace(/(?:https?:\/\/|www\.|t\.me)\S*/gi, "") // strip URLs completely
    .replace(/@\s*[a-zA-Z_][a-zA-Z0-9_]*/g, "");     // strip Telegram handles completely

  // Remove common promo phrases inline
  const inlinePromoPhrases = [
    /\bdeposit\s+\$?\d+/gi,
    /\bfree\s+vip\b/gi,
    /\bjoin\s+vip\b/gi,
    /\bjoin\s+now\b/gi,
    /\bjoin\s+channel\b/gi,
    /\bcontact\s+to\s+join\b/gi,
    /\bcontact\s+@\s*\w+/gi,
    /\bsign\s*up\s*(?:on|at|with)?\b/gi,
    /\bregister\s*(?:on|at|with)?\b/gi,
    /\breferral\s+link\b/gi
  ];

  for (const pattern of inlinePromoPhrases) {
    processedText = processedText.replace(pattern, "");
  }

  return processedText;
}

export function detectRawPair(text = "") {
  const cleanedText = cleanTextForPairDetection(text);
  const normalizedText = String(cleanedText || "").toUpperCase();

  // 1. Explicit declaration has absolute priority (e.g. PAIR = SHOPIFY)
  const explicitMatch = normalizedText.match(/\b(?:PAIR|SYMBOL|INSTRUMENT|ASSET)\s*[:=]\s*([A-Z0-9#/-]{3,12})\b/);
  if (explicitMatch?.[1]) {
    const candidate = explicitMatch[1];
    if (isValidPairCandidate(candidate)) {
      return candidate;
    }
  }

  // 2. Hashtags of structured/known pairs
  const hashtagPair = findHashtagPair(normalizedText);
  if (hashtagPair) {
    return hashtagPair;
  }

  // 3. Structured pairs (Forex, Crypto, Index)
  const structuredPair = findRawStructuredPair(normalizedText);
  if (structuredPair) {
    return structuredPair;
  }

  // 4. Known aliases matching
  const aliases = [...aliasMap.keys()].sort((left, right) => right.length - left.length);
  const aliasMatch = aliases.find((alias) => createAliasPattern(alias).test(normalizedText));
  if (aliasMatch) {
    return aliasMatch;
  }

  // 5. Compact Action Match (e.g. BUYGBPUSD or BUYSHOPIFY)
  const compactActionMatch = normalizedText.match(/\b(?:BUY|SELL|LONG|SHORT)([A-Z0-9/]{3,12})\b/);
  if (compactActionMatch?.[1]) {
    const candidate = compactActionMatch[1];
    if (isValidPairCandidate(candidate)) {
      return candidate;
    }
  }

  // 6. Action-adjacent matches for unknown assets (e.g. BUY SHOPIFY or SHOPIFY BUY)
  const buySellMatch = normalizedText.match(/\b(?:BUY|SELL|LONG|SHORT)\s+([A-Z0-9#/-]{3,12})\b/);
  if (buySellMatch?.[1]) {
    const candidate = buySellMatch[1];
    if (isValidPairCandidate(candidate)) {
      return candidate;
    }
  }

  const reverseBuySellMatch = normalizedText.match(/\b([A-Z0-9#/-]{3,12})\s+(?:BUY|SELL|LONG|SHORT)\b/);
  if (reverseBuySellMatch?.[1]) {
    const candidate = reverseBuySellMatch[1];
    if (isValidPairCandidate(candidate)) {
      return candidate;
    }
  }

  // 7. Generic hashtag (e.g. #SHOPIFY)
  const genericHashtag = normalizedText.match(/#([A-Z0-9]{3,12})\b/);
  if (genericHashtag?.[1]) {
    const candidate = genericHashtag[1];
    if (isValidPairCandidate(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function detectTradingPair(text = "") {
  const raw = detectRawPair(text);
  return raw ? normalizePair(raw, false) : null;
}

export function hasTradingPair(text = "") {
  return Boolean(detectTradingPair(text));
}

export function createPairTokenPattern() {
  const aliasPattern = [...aliasMap.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .map((alias) => alias.replace(/\\\//g, "\\s*[/]?\\s*").replace(/\s+/g, "\\s+"))
    .join("|");
  const forexPattern = "[A-Z]{3}\\s*[/]?\\s*[A-Z]{3}";
  const quotedCryptoPattern = "[A-Z]{2,8}\\s*[/]?\\s*(?:USDT|USDC|USD|BTC|ETH)";
  const indexPattern = "[A-Z]{2,5}\\d{2,3}";

  return new RegExp(`(?:${aliasPattern}|${forexPattern}|${quotedCryptoPattern}|${indexPattern})`);
}

export function normalizeTradingPair(pair) {
  const norm = normalizePair(pair, false);
  return norm && RECOGNIZED_ASSETS.has(norm) ? norm : "unknown";
}

export function normalizePair(pairStr, shouldLog = false) {
  if (!pairStr) return null;
  const original = String(pairStr).trim();

  let cleaned = original.toUpperCase().replace(/#/g, "").replace(/\//g, "").trim();
  cleaned = cleaned.replace(/\s+/g, " ");

  if (/^[0-9.‐–——-\s]+$/.test(cleaned)) {
    return null;
  }

  let normalized = cleaned;

  if (aliasMap.has(cleaned)) {
    normalized = aliasMap.get(cleaned);
  } else {
    // Check standard formats
    const isForex = cleaned.length === 6 &&
      currencyCodes.has(cleaned.slice(0, 3)) &&
      currencyCodes.has(cleaned.slice(3)) &&
      cleaned.slice(0, 3) !== cleaned.slice(3);

    const cryptoQuotes = ["USDT", "USDC", "USD", "BTC", "ETH"];
    const isCrypto = cryptoQuotes.some((quote) => {
      if (cleaned.endsWith(quote) && cleaned.length > quote.length) {
        const base = cleaned.slice(0, -quote.length);
        return !currencyCodes.has(base);
      }
      return false;
    });

    const isIndex = /^[A-Z]{2,5}\d{2,3}$/.test(cleaned);

    if (!isForex && !isCrypto && !isIndex) {
      if (shouldLog) {
        logger.info("unknown_pair_alias", { pair: original });
      }
      return null;
    }
  }

  if (normalized && RECOGNIZED_ASSETS.has(normalized)) {
    if (shouldLog && normalized !== original) {
      logger.info("pair_normalized", { original, normalized });
    }
    return normalized;
  }

  return null;
}

function findHashtagPair(text) {
  for (const match of text.matchAll(/#([A-Z0-9]{3,12})\b/g)) {
    const pair = findRawStructuredPair(match[1]);
    if (pair) {
      return match[0];
    }
  }
  return null;
}

function findRawStructuredPair(text) {
  const forexPair = findRawForexPair(text);
  if (forexPair) return forexPair;

  const cryptoPair = findRawCryptoPair(text);
  if (cryptoPair) return cryptoPair;

  const indexSymbol = findRawIndexSymbol(text);
  if (indexSymbol) return indexSymbol;

  return null;
}

function findRawForexPair(text) {
  for (const match of text.matchAll(/\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/g)) {
    const [, base, quote] = match;
    if (["BUY", "SELL", "LONG", "SHORT"].includes(base) || ["BUY", "SELL", "LONG", "SHORT"].includes(quote)) {
      continue;
    }
    if (currencyCodes.has(base) && currencyCodes.has(quote) && base !== quote) {
      return match[0];
    }
  }

  for (const match of text.matchAll(/\b([A-Z]{6})\b/g)) {
    const token = match[1];
    const base = token.slice(0, 3);
    const quote = token.slice(3);
    if (["BUY", "SELL", "LONG", "SHORT"].includes(base) || ["BUY", "SELL", "LONG", "SHORT"].includes(quote)) {
      continue;
    }
    if (currencyCodes.has(base) && currencyCodes.has(quote) && base !== quote) {
      return token;
    }
  }

  return null;
}

function findRawCryptoPair(text) {
  for (const match of text.matchAll(/\b([A-Z]{2,8})\s*\/\s*(USDT|USDC|USD|BTC|ETH)\b/g)) {
    const [, base, quote] = match;
    if (["BUY", "SELL", "LONG", "SHORT"].includes(base)) {
      continue;
    }
    const compact = `${base}${quote}`;
    if (!currencyCodes.has(base) && !ignoredIndexLikeTokens.has(compact)) {
      return match[0];
    }
  }

  for (const match of text.matchAll(/\b([A-Z]{2,8})(USDT|USDC|USD|BTC|ETH)\b/g)) {
    const [, base, quote] = match;
    if (["BUY", "SELL", "LONG", "SHORT"].includes(base)) {
      continue;
    }
    const compact = `${base}${quote}`;
    if (!currencyCodes.has(base) && !ignoredIndexLikeTokens.has(compact)) {
      return match[0];
    }
  }

  return null;
}

function findRawIndexSymbol(text) {
  for (const match of text.matchAll(/\b([A-Z]{2,5}\d{2,3})\b/g)) {
    const symbol = match[1];
    const nextCharacter = text[match.index + symbol.length];
    const prefix = symbol.replace(/\d+$/, "");
    if (ignoredPairWords.has(prefix) || ["BUY", "SELL", "LONG", "SHORT"].includes(prefix)) {
      continue;
    }
    if (!ignoredIndexLikeTokens.has(symbol) && !symbol.startsWith("TP") && nextCharacter !== "%") {
      return symbol;
    }
  }

  return null;
}

function createAliasPattern(alias) {
  const escaped = escapeRegex(alias).replace(/\\\//g, "\\s*[/]?\\s*").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\b)${escaped}(\\b|$)`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
