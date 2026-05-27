const aliasMap = new Map([
  ["GOLD", "XAUUSD"],
  ["XAU", "XAUUSD"],
  ["XAUUSD", "XAUUSD"],
  ["XAU/USD", "XAUUSD"],
  ["SILVER", "XAGUSD"],
  ["XAG", "XAGUSD"],
  ["XAGUSD", "XAGUSD"],
  ["XAG/USD", "XAGUSD"],
  ["BTC", "BTCUSD"],
  ["BITCOIN", "BTCUSD"],
  ["BTCUSD", "BTCUSD"],
  ["BTC/USD", "BTCUSD"],
  ["ETH", "ETHUSD"],
  ["ETHEREUM", "ETHUSD"],
  ["ETHUSD", "ETHUSD"],
  ["ETH/USD", "ETHUSD"],
  ["DOW", "US30"],
  ["DOW JONES", "US30"],
  ["NASDAQ", "NAS100"],
  ["USTEC", "NAS100"],
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

export function detectTradingPair(text = "") {
  const normalizedText = String(text || "").toUpperCase();
  const compactActionMatch = normalizedText.match(/\b(?:BUY|SELL|LONG|SHORT)([A-Z0-9/]{3,12})\b/);

  if (compactActionMatch?.[1]) {
    const compactActionPair = detectTradingPair(compactActionMatch[1]);

    if (compactActionPair) {
      return compactActionPair;
    }
  }

  const aliasMatch = findAliasMatch(normalizedText);

  if (aliasMatch) {
    return aliasMatch;
  }

  return findStructuredPair(normalizedText);
}

export function hasTradingPair(text = "") {
  return Boolean(detectTradingPair(text));
}

export function createPairTokenPattern() {
  const aliasPattern = [...aliasMap.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .map((alias) => alias.replace(/\\\//g, "\\s*[/]?\\s*"))
    .join("|");
  const forexPattern = "[A-Z]{3}\\s*[/]?\\s*[A-Z]{3}";
  const quotedCryptoPattern = "[A-Z]{2,8}\\s*[/]?\\s*(?:USDT|USDC|USD|BTC|ETH)";
  const indexPattern = "[A-Z]{2,5}\\d{2,3}";

  return new RegExp(`(?:${aliasPattern}|${forexPattern}|${quotedCryptoPattern}|${indexPattern})`);
}

export function normalizeTradingPair(pair) {
  const detectedPair = detectTradingPair(pair);

  if (detectedPair) {
    return detectedPair;
  }

  return String(pair || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function findAliasMatch(text) {
  const aliases = [...aliasMap.keys()].sort((left, right) => right.length - left.length);
  const match = aliases.find((alias) => createAliasPattern(alias).test(text));

  return match ? aliasMap.get(match) : null;
}

function findStructuredPair(text) {
  const forexPair = findForexPair(text);
  if (forexPair) {
    return forexPair;
  }

  const cryptoPair = findQuotedCryptoPair(text);
  if (cryptoPair) {
    return cryptoPair;
  }

  const indexSymbol = findIndexSymbol(text);
  if (indexSymbol) {
    return indexSymbol;
  }

  return null;
}

function findForexPair(text) {
  for (const match of text.matchAll(/\b([A-Z]{3})\s*[/]?\s*([A-Z]{3})\b/g)) {
    const [, base, quote] = match;

    if (currencyCodes.has(base) && currencyCodes.has(quote) && base !== quote) {
      return `${base}${quote}`;
    }
  }

  return null;
}

function findQuotedCryptoPair(text) {
  for (const match of text.matchAll(/\b([A-Z]{2,8})\s*[/]?\s*(USDT|USDC|USD|BTC|ETH)\b/g)) {
    const [, base, quote] = match;
    const compact = `${base}${quote}`;

    if (!currencyCodes.has(base) && !ignoredIndexLikeTokens.has(compact)) {
      return compact;
    }
  }

  return null;
}

function findIndexSymbol(text) {
  for (const match of text.matchAll(/\b([A-Z]{2,5}\d{2,3})\b/g)) {
    const symbol = match[1];

    if (!ignoredIndexLikeTokens.has(symbol) && !symbol.startsWith("TP")) {
      return symbol;
    }
  }

  return null;
}

function createAliasPattern(alias) {
  const escaped = escapeRegex(alias).replace(/\\\//g, "\\s*[/]?\\s*");
  return new RegExp(`(^|\\b)${escaped}(\\b|$)`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
