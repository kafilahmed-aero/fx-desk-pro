import { getPriceHistory } from "./priceIngestionService.js";

const localContexts = new Map();

/**
 * Builds candles of custom minute interval from raw tick stream
 */
export function buildCandles(ticks, intervalMin) {
  if (!Array.isArray(ticks) || ticks.length === 0) {
    return [];
  }
  const intervalMs = intervalMin * 60 * 1000;
  const groups = new Map();

  ticks.forEach((t) => {
    const bucket = Math.floor(t.timestamp / intervalMs) * intervalMs;
    if (!groups.has(bucket)) {
      groups.set(bucket, []);
    }
    groups.get(bucket).push(t.price);
  });

  const candles = [];
  const sortedBuckets = Array.from(groups.keys()).sort((a, b) => a - b);

  sortedBuckets.forEach((bucket) => {
    const prices = groups.get(bucket);
    candles.push({
      timestamp: bucket,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
    });
  });

  return candles;
}

/**
 * Computes metrics for a single timeframe candle set
 */
function calculateMetricsForTimeframe(candles) {
  const minCandlesThreshold = 10;
  const targetCandlesCount = 30;

  const coverage = Math.min(100, Math.round((candles.length / targetCandlesCount) * 100));

  if (candles.length < minCandlesThreshold) {
    return {
      currentPrice: null,
      highestPrice: null,
      lowestPrice: null,
      tradingRange: null,
      ATR: null,
      trendDirection: null,
      trendScore: null,
      trendStrength: null,
      momentum: null,
      momentumScore: null,
      volatility: null,
      volatilityValue: null,
      marketPhase: null,
      marketPhaseConfidence: null,
      historyCoverage: coverage,
      status: "INSUFFICIENT_HISTORY",
    };
  }

  // 1. Current Price
  const currentPrice = candles[candles.length - 1].close;

  // 2. Highest / Lowest Price
  const highestPrice = Math.max(...candles.map((c) => c.high));
  const lowestPrice = Math.min(...candles.map((c) => c.low));

  // 3. Trading Range
  const tradingRange = highestPrice - lowestPrice;

  // 4. ATR (Average True Range over 14 periods)
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }
  const atrPeriod = Math.min(14, trs.length);
  const recentTrs = trs.slice(-atrPeriod);
  const ATR = recentTrs.length > 0 ? recentTrs.reduce((sum, val) => sum + val, 0) / atrPeriod : 0.5;

  // 5. Trend Direction & Score
  const trendLookback = Math.min(20, candles.length);
  const startCandle = candles[candles.length - trendLookback];
  const endCandle = candles[candles.length - 1];
  const priceDiff = endCandle.close - startCandle.open;

  let trendDirection = "Neutral";
  if (ATR > 0) {
    if (priceDiff > ATR * 0.5) trendDirection = "Bullish";
    else if (priceDiff < -ATR * 0.5) trendDirection = "Bearish";
  }

  const ratio = ATR > 0 ? priceDiff / (ATR * 3) : 0;
  const trendScore = Math.max(-100, Math.min(100, Math.round(ratio * 100)));

  // 6. Trend Strength
  const absScore = Math.abs(trendScore);
  let trendStrength = "Weak";
  if (absScore >= 70) trendStrength = "Strong";
  else if (absScore >= 30) trendStrength = "Moderate";

  // 7. Momentum & Momentum Score
  const momLookback = 3;
  const momStart = candles[candles.length - momLookback - 1] || candles[0];
  const momEnd = candles[candles.length - 1];
  const momDiff = momEnd.close - momStart.close;

  let momentum = "Neutral";
  if (ATR > 0) {
    if (momDiff > ATR * 0.2) momentum = "Bullish";
    else if (momDiff < -ATR * 0.2) momentum = "Bearish";
  }

  const momRatio = ATR > 0 ? momDiff / (ATR * 1.5) : 0;
  const momentumScore = Math.max(-100, Math.min(100, Math.round(momRatio * 100)));

  // 8. Volatility Value & Category
  const volPeriod = Math.min(14, candles.length);
  const recentCloses = candles.slice(-volPeriod).map((c) => c.close);
  const mean = recentCloses.reduce((s, v) => s + v, 0) / volPeriod;
  const variance = recentCloses.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / volPeriod;
  const volatilityValue = Math.sqrt(variance);

  let volatility = "Medium";
  if (ATR > 0) {
    const volRatio = volatilityValue / ATR;
    if (volRatio > 1.2) volatility = "High";
    else if (volRatio < 0.6) volatility = "Low";
  }

  // 9. Market Phase
  let marketPhase = "Ranging";
  if (trendStrength === "Strong") {
    if (momentum === trendDirection) {
      marketPhase = "Trending";
    } else if (momentum !== "Neutral") {
      marketPhase = "Pullback";
    } else {
      marketPhase = "Trending";
    }
  } else if (trendStrength === "Moderate") {
    if (momentum === trendDirection) {
      marketPhase = "Breakout";
    } else {
      marketPhase = "Ranging";
    }
  } else {
    if (momentum !== "Neutral" && momentum !== trendDirection) {
      marketPhase = "Reversal";
    } else {
      marketPhase = "Ranging";
    }
  }

  // 10. Market Phase Confidence
  let confidence = 50;
  if (trendDirection !== "Neutral" && momentum === trendDirection) {
    confidence += 20;
  }
  confidence = Math.round(confidence * (coverage / 100));
  const marketPhaseConfidence = Math.max(0, Math.min(100, confidence));

  return {
    currentPrice,
    highestPrice,
    lowestPrice,
    tradingRange,
    ATR,
    trendDirection,
    trendScore,
    trendStrength,
    momentum,
    momentumScore,
    volatility,
    volatilityValue,
    marketPhase,
    marketPhaseConfidence,
    historyCoverage: coverage,
    status: "OK",
  };
}

/**
 * Builds multi-timeframe context for a pair
 */
export function buildMultiTimeframeContext(pair) {
  const normalized = String(pair).toUpperCase().trim();
  const ticks = getPriceHistory(normalized);

  const context = {
    "1m": calculateMetricsForTimeframe(buildCandles(ticks, 1)),
    "5m": calculateMetricsForTimeframe(buildCandles(ticks, 5)),
    "15m": calculateMetricsForTimeframe(buildCandles(ticks, 15)),
    "1h": calculateMetricsForTimeframe(buildCandles(ticks, 60)),
    "4h": calculateMetricsForTimeframe(buildCandles(ticks, 240)),
  };

  localContexts.set(normalized, context);
  return context;
}

/**
 * Gets cached or builds multi-timeframe context
 */
export function getMultiTimeframeContext(pair) {
  const normalized = String(pair).toUpperCase().trim();
  if (localContexts.has(normalized)) {
    return localContexts.get(normalized);
  }
  return buildMultiTimeframeContext(normalized);
}
