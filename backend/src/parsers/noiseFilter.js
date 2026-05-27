import { normalizeMessageText } from "./messageNormalizer.js";
import { hasTradingPair } from "./pairDetector.js";

const signalKeywords = [
  "BUY",
  "SELL",
  "LONG",
  "SHORT",
  "TP",
  "TAKE PROFIT",
  "TARGET",
  "SL",
  "STOP LOSS",
  "ENTRY",
  "ENTRIES",
];

const updateKeywords = [
  "MOVE SL",
  "MOVE STOP",
  "BREAKEVEN",
  "BREAK EVEN",
  "BE",
  "TRAIL SL",
  "TRAIL STOP",
  "CLOSE PARTIAL",
  "PARTIAL PROFIT",
  "PARTIAL PROFITS",
  "HOLD TRADE",
  "HOLD",
  "BOOK PROFITS",
  "BOOK PROFIT",
  "CLOSE TRADE",
  "CLOSE NOW",
  "EXIT TRADE",
  "EXIT NOW",
  "FULL CLOSE",
  "CANCEL",
  "CANCELLED",
  "CANCELED",
  "IGNORE SETUP",
];

const resultKeywords = [
  "TP HIT",
  "TP1 HIT",
  "TP2 HIT",
  "TP3 HIT",
  "TARGET HIT",
  "DONE",
  "REACHED",
  "PROFIT BOOKED",
  "SL HIT",
  "STOP LOSS HIT",
  "LOSS",
  "WIN",
];

const promoKeywords = [
  "VIP",
  "VIP GROUP",
  "VIP SIGNAL",
  "VIP SIGNALS",
  "VIP SPOTS",
  "JOIN NOW",
  "JOIN VIP",
  "SUBSCRIBE",
  "PAYMENT",
  "REFERRAL",
  "REFER",
  "AFFILIATE",
  "PROMO",
  "DISCOUNT",
  "DM ME",
  "DM FOR",
  "CONTACT ADMIN",
  "MESSAGE ADMIN",
  "SIGNAL GROUP",
  "PREMIUM",
  "PREMIUM SIGNALS",
  "COPY SIGNALS",
  "DEPOSIT NOW",
  "ACCOUNT MANAGER",
  "GUARANTEED PROFIT",
  "100% ACCURACY",
  "ACCURACY",
  "LIMITED SPOTS",
  "PAID GROUP",
  "COPY TRADING",
  "MEMBERSHIP",
  "SIGNAL SUBSCRIPTION",
];

const chatterKeywords = [
  "GOOD MORNING",
  "GOOD NIGHT",
  "WISH YOU",
  "GOOD LUCK",
  "STAY DISCIPLINED",
  "DISCIPLINE",
  "PATIENCE",
  "MOTIVATION",
  "HAPPY WEEKEND",
  "HAPPY MONDAY",
  "TRADERS",
];

const newsKeywords = [
  "CPI",
  "NFP",
  "FOMC",
  "FED",
  "INTEREST RATE",
  "INFLATION",
  "GDP",
  "NEWS",
  "BREAKING",
];

const marketAnalysisKeywords = [
  "BIAS",
  "BULLISH",
  "BEARISH",
  "MY OPINION",
  "MORNING VIEW",
  "CHART IDEA",
  "WHAT NEXT",
  "GOAL",
  "FORECAST",
  "VIEW",
  "IDEA",
  "TIME FRAME",
  "TIMEFRAME",
  "TF",
  "4H",
  "1H",
  "DAILY",
];

const linkPattern = /(https?:\/\/|t\.me\/|telegram\.me\/)/i;
const tradingNumberPattern = /\b\d{1,6}(?:\.\d{1,5})?\b/g;

export function classifyMessage(rawMessage = {}) {
  const normalized = normalizeMessageText(getMessageText(rawMessage));

  if (!normalized.hasText) {
    return createResult("NOISE", normalized, {
      noText: true,
      hasMedia: Boolean(rawMessage.hasMedia || rawMessage.mediaType),
    });
  }

  const text = normalized.compactText;
  const reasons = getClassificationReasons(text, rawMessage);
  const classification = getClassification(reasons);

  return createResult(classification, normalized, reasons);
}

function createResult(classification, normalized, reasons) {
  return {
    classification,
    signalScore: reasons.signalScore || 0,
    updateScore: reasons.updateScore || 0,
    resultScore: reasons.resultScore || 0,
    marketAnalysisScore: reasons.marketAnalysisScore || 0,
    promoScore: reasons.promoScore || 0,
    newsScore: reasons.newsScore || 0,
    noiseScore: reasons.noiseScore || 0,
    reasons,
    normalized,
  };
}

function getClassification(reasons) {
  if (reasons.resultScore >= 2 && reasons.resultScore >= reasons.signalScore) {
    return "RESULT_SIGNAL";
  }

  if (reasons.updateScore >= 2 && reasons.updateScore >= reasons.signalScore) {
    return "UPDATE_SIGNAL";
  }

  if (reasons.promoScore >= 2 && reasons.promoScore >= reasons.signalScore) {
    return "PROMO";
  }

  if (
    reasons.hasTradingPair &&
    reasons.marketAnalysisScore >= 2 &&
    reasons.marketAnalysisScore >= reasons.signalScore - 1
  ) {
    return "MARKET_ANALYSIS";
  }

  if (reasons.hasTradingPair && reasons.hasAction) {
    return "NEW_SIGNAL";
  }

  if (reasons.signalScore >= 3 && reasons.signalScore >= reasons.noiseScore) {
    return "NEW_SIGNAL";
  }

  if (reasons.newsScore >= 2 && reasons.signalScore < 3) {
    return "NEWS";
  }

  return "NOISE";
}

function getClassificationReasons(text, rawMessage) {
  const signalScore = getSignalScore(text);
  const updateScore = getUpdateScore(text);
  const resultScore = getResultScore(text);
  const marketAnalysisScore = getMarketAnalysisScore(text);
  const promoScore = getPromoScore(text);
  const newsScore = getNewsScore(text);
  const noiseScore = getNoiseScore(text, rawMessage, promoScore);

  return {
    signalScore,
    updateScore,
    resultScore,
    marketAnalysisScore,
    promoScore,
    newsScore,
    noiseScore,
    hasTradingPair: hasTradingPair(text),
    hasAction: /\b(BUY|SELL|LONG|SHORT)\b/.test(text),
    hasDirectionalBias: /\b(BULLISH|BEARISH)\b/.test(text),
    hasRiskLevels: /\b(TP|TAKE PROFIT|TARGET|SL|STOP LOSS)\b/.test(text),
    hasManagementLanguage: updateKeywords.some((keyword) =>
      createKeywordPattern(keyword).test(text)
    ),
    hasResultLanguage: resultKeywords.some((keyword) =>
      createKeywordPattern(keyword).test(text)
    ),
    hasNoiseLink: linkPattern.test(text),
    hasMedia: Boolean(rawMessage.hasMedia || rawMessage.mediaType),
  };
}

function getMarketAnalysisScore(text) {
  let score = countMatches(text, marketAnalysisKeywords);

  if (/\bBIAS\b\s*[:@-]?\s*(BULLISH|BEARISH|BUY|SELL)\b/.test(text)) {
    score += 2;
  }

  if (/\b(GOAL|TARGET|FORECAST)\b\s*[:@-]?\s*\d/.test(text)) {
    score += 1;
  }

  if (/\b(?:TIME\s*FRAME|TIMEFRAME|TF)\b\s*[:@-]?\s*(M\d+|H\d+|\d+H|DAILY|WEEKLY|D1|H4|H1)\b/.test(text)) {
    score += 1;
  }

  return score;
}

function getSignalScore(text) {
  let score = countMatches(text, signalKeywords);

  if (hasTradingPair(text)) {
    score += 2;
  }

  const numbers = text.match(tradingNumberPattern) || [];
  if (numbers.length >= 2) {
    score += 1;
  }

  if (/\b(BUY|SELL|LONG|SHORT)\b[\s\S]{0,40}\b\d{2,6}(?:\.\d+)?\b/.test(text)) {
    score += 2;
  }

  if (/\b(TP\s*\d*|TAKE PROFIT|TARGET|SL)\b\s*[:@-]?\s*\d/.test(text)) {
    score += 2;
  }

  return score;
}

function getUpdateScore(text) {
  let score = countMatches(text, updateKeywords);

  if (/\b(SL|STOP LOSS)\b[\s\S]{0,24}\b(BE|BREAKEVEN|BREAK EVEN)\b/.test(text)) {
    score += 2;
  }

  if (/\b(BREAKEVEN|BREAK EVEN)\b/.test(text)) {
    score += 2;
  }

  if (/\b(MOVE\s+(SL|STOP)|SL\s+TO\s+ENTRY|MOVE\s+STOP\s+(ABOVE|BELOW)|MOVE\s+SL\s+(HIGHER|LOWER))\b/.test(text)) {
    score += 2;
  }

  if (
    /\bCLOSE\s*[\s\S]{0,24}\b(PARTIAL|HALF|PROFIT|PROFITS)\b/.test(text) ||
    /\bCLOSE\s*[\s\S]{0,24}\d{1,3}\s*%/.test(text)
  ) {
    score += 2;
  }

  if (/\bBOOK\b[\s\S]{0,24}\b(PARTIAL|PROFIT|PROFITS)\b/.test(text)) {
    score += 2;
  }

  if (/\b(PARTIAL\s+(PROFIT|PROFITS|CLOSE)|SECURE\s+PARTIAL|TAKE\s+(SOME\s+)?PROFITS?|TAKE\s+PARTIAL|BOOK\s+\d{1,3}\s*%)\b/.test(text)) {
    score += 2;
  }

  if (/\b(TRAIL|TRAILING)\b[\s\S]{0,16}\b(SL|STOP)\b/.test(text)) {
    score += 2;
  }

  if (/\b(HOLD|HOLDING)\b/.test(text)) {
    score += 2;
  }

  if (/\b(CLOSE|EXIT|FULL CLOSE|MANUAL CLOSE)\b[\s\S]{0,24}\b(TRADE|POSITION|ALL|NOW|SETUP|REMAINING|REST|ASAP|EVERYTHING)\b/.test(text)) {
    score += 2;
  }

  return score;
}

function getResultScore(text) {
  let score = countMatches(text, resultKeywords);

  if (/\b(TP|T\/P|TARGET|TAKE PROFIT)\s*\d*\s*(HIT|DONE|REACHED)\b/.test(text)) {
    score += 3;
  }

  if (/\b(SL|STOP LOSS)\s*(HIT|DONE|REACHED)\b/.test(text)) {
    score += 3;
  }

  return score;
}

function getPromoScore(text) {
  let score = countMatches(text, promoKeywords);

  if (linkPattern.test(text)) {
    score += 1;
  }

  if (/\b(JOIN|DM|CONTACT|SUBSCRIBE)\b[\s\S]{0,30}\b(VIP|PREMIUM|ADMIN)\b/.test(text)) {
    score += 2;
  }

  if (/\b(VIP|PREMIUM)\b[\s\S]{0,30}\b(SPOTS?|SIGNALS?|GROUP|ROOM|ACCESS)\b/.test(text)) {
    score += 2;
  }

  if (/\b(DEPOSIT|FUND|INVEST)\b[\s\S]{0,30}\b(COPY|SIGNALS?|ACCOUNT|PROFIT)\b/.test(text)) {
    score += 2;
  }

  if (/\b(COPY|COPYING|COPIER|COPY TRADING)\b[\s\S]{0,30}\b(SIGNALS?|TRADES?|SERVICE|OFFER|PROFIT)\b/.test(text)) {
    score += 2;
  }

  if (/\b(REFERRAL|REFER|AFFILIATE|BONUS|PROMO CODE|INVITE LINK)\b/.test(text)) {
    score += 2;
  }

  if (/\b(MESSAGE|DM|CONTACT)\b[\s\S]{0,30}\b(ADMIN|ME|US)\b/.test(text)) {
    score += 2;
  }

  if (/\b(ADMIN|PAYMENT|SUBSCRIBE|SUBSCRIPTION)\b[\s\S]{0,30}\b(PAYMENT|DM|ADMIN|SIGNALS?|OPEN|LINK)\b/.test(text)) {
    score += 2;
  }

  if (/\b\d{2,3}%\s*(ACCURACY|WIN RATE|PROFIT|GUARANTEED)\b/.test(text)) {
    score += 2;
  }

  if (/\b\d{2,3}\s*PERCENT\s*(ACCURACY|WIN RATE|PROFIT|GUARANTEED)\b/.test(text)) {
    score += 2;
  }

  if (/\b(GUARANTEED|SURE|DAILY|WEEKLY)\b[\s\S]{0,30}\b(PROFIT|INCOME|RETURNS?)\b/.test(text)) {
    score += 2;
  }

  if (/\b(VIP|PREMIUM)\b[\s\S]{0,30}\b(MEMBERSHIP|SEATS?|FULL|AVAILABLE|SERVICE)\b/.test(text)) {
    score += 2;
  }

  if (/\b(JOIN|LIMITED|FEW|PAID)\b[\s\S]{0,30}\b(SEATS?|SPOTS?|GROUP|ENTRIES)\b/.test(text)) {
    score += 2;
  }

  return score;
}

function getNewsScore(text) {
  return countMatches(text, newsKeywords);
}

function getNoiseScore(text, rawMessage, promoScore) {
  let score = promoScore;

  if (countMatches(text, chatterKeywords) > 0) {
    score += 2;
  }

  if (text.length > 700) {
    score += 1;
  }

  if (Boolean(rawMessage.hasMedia || rawMessage.mediaType) && text.length < 20) {
    score += 2;
  }

  return score;
}

function getMessageText(rawMessage) {
  return [rawMessage?.text, rawMessage?.caption, rawMessage?.captionText, rawMessage?.message]
    .find((value) => String(value || "").trim().length > 0) || "";
}

function countMatches(text, keywords) {
  return keywords.reduce((count, keyword) => {
    return createKeywordPattern(keyword).test(text) ? count + 1 : count;
  }, 0);
}

function createKeywordPattern(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped.replace(/\s+/g, "\\s+")}\\b`);
}
