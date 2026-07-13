import { normalizeMessageText } from "./messageNormalizer.js";
import { hasTradingPair } from "./pairDetector.js";
import { parseSignalMessage } from "./signalParser.js";

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
  "CONFIRMATION",
  "PATTERN",
  "LAYERS",
  "DAILY ANALYSIS",
  "MACRO LAYERS",
  "SELL CONFIRMATION",
  "BULLISH PATTERN",
  "BEARISH PATTERN",
  "DAILY CONTEXT CHECK",
  "PD HIGH",
  "PD LOW",
  "LOOKS LIKE",
  "MY DEAR FOLLOWERS",
];

const promoPatterns = [
  // VIP / Subscription Promotion
  /\bvip\b/i,
  /\bjoin\s+vip\b/i,
  /\bvip\s+group\b/i,
  /\bpremium\s+group\b/i,
  /\bpremium\s+signals?\b/i,
  /\bpaid\s+signals?\b/i,
  /\bmembership\b/i,
  /\bsubscription\b/i,
  /\bupgrade\s+plan\b/i,
  /\bsignal\s+package\b/i,

  // Contact / Sales Promotion
  /\bcontact\s*me\b/i,
  /\bcontact\s*(?:@|at)?\s*admin\b/i,
  /\bdm\s*me\b/i,
  /\bwhatsapp\b/i,
  /\btelegram\s*me\b/i,
  /\binbox\s*me\b/i,
  /\bmessage\s*me\s*privately\b/i,

  // Broker Promotion
  /\bregister\s+now\b/i,
  /\bopen\s+account\b/i,
  /\bbroker\s+link\b/i,
  /\breferral\s+link\b/i,
  /\bdeposit\s+bonus\b/i,
  /\btrading\s+bonus\b/i,
  /\bfunded\s+account\b/i,
  /\bregister\b.*\bbroker\b/i,
  /\bregister\b.*\bbonus\b/i,
  /\bbroker\b.*\bbonus\b/i,

  // Service Promotion
  /\baccount\s+management\b/i,
  /\bcopy\s+trading(?:\s+service)?\b/i,
  /\bmanaged\s+account\b/i,
  /\binvestment\s+plan\b/i,
  /\bpassive\s+income\b/i,

  // Educational / Non-trade Content
  /\bmarket\s+analysis\s+only\b/i,
  /\bweekly\s+outlook\b/i,
  /\bdaily\s+forecast\b/i,
  /\btrading\s+psychology\b/i,
  /\blesson\b/i,
  /\btutorial\b/i,
  /\bwebinar\b/i,

  // Channel Growth Promotion
  /\bsubscribe\b/i,
  /\bfollow\s+us\b/i,
  /\bjoin\s+channel\b/i,
  /\binvite\s+friends\b/i,
  /\bgiveaway\b/i,
  /\bcontest\b/i,
  
  // Custom VIP / Promotion extensions
  /\bpremium\s+access\b/i,
  /\bvip\s+(?:room|channel|access|subscription|setup|alert)\b/i,
  /\bjoin\s+(?:here|now|vip|premium|channel)\b/i,
  /\bcontact\s+(?:admin|support|me|us)\b/i,
  /\bdm\s+(?:admin|me)\b/i,
  /\bmessage\s+(?:admin|me)\b/i,
  /\bdeposit\s+(?:instructions?|bonus|now|fund)\b/i,
  /\bpayment\s+(?:screenshot|proof|receipt|received|done)\b/i,
  /\b(?:broker|referral|affiliate|invite|promo|discount)\s+link\b/i,
  /\bsign\s*up\s*(?:with|on)?\s*broker\b/i,
  /\bopen\s+account\b/i,
  /\bexclusive\s+offer\b/i,
  /\blimited\s+spots?\b/i,
  /\bclaim\s+your\s+spot\b/i,
  /\bwin\s*rate\b/i
];

function isPromoByKeywords(text) {
  return promoPatterns.some((pattern) => pattern.test(text));
}

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
  
  // Parse signal first to apply Setup Setup Dominance check
  const parsed = parseSignalMessage(rawMessage, "NEW_SIGNAL");
  const hasPair = !!parsed.pair && parsed.pair !== "unknown";
  const hasAction = !!parsed.action;
  const hasEntry = (parsed.entry !== null && parsed.entry !== undefined) || (parsed.entryRange && parsed.entryRange.length > 0);
  const hasTP = (parsed.targets && parsed.targets.length > 0) || (parsed.pipTargets && parsed.pipTargets.length > 0) || parsed.isOpenTarget;
  const hasSL = (parsed.stopLoss !== null && parsed.stopLoss !== undefined) || parsed.hiddenStopLoss;

  const isSignal = hasPair && hasAction && hasEntry && hasTP && hasSL;
  const containsPromoKeywords = isPromoByKeywords(normalized.originalText);
  
  // Expand hasResultPhrase to capture running profits, hits, pips done, updates, etc.
  const hasResultPhrase = /\b(?:stopped? out|tp\s*\d*\s*(?:hitted|hit|complete|achieved|done|miss(?:ed)?)|targets?\s*(?:\d+|[¹²³⁴⁵])?\s*(?:hitted|hit|complete|achieved|done|miss(?:ed)?)|closed? in (?:profit|loss)|setup failed|running\s+(?:profit|pips?)|\d+\s*\+?\s*pips?\s*(?:running|profit|done|gain|secured|hit)|\d+\s*(?:hitted|hit|complete|achieved|done|gain)\s*pips?|boom\s*boom\s*tp|closed?\s+manually|manual\s+close|book\s+profit|secure\s+profit|secured\s+profit|profit\s+secured|running\s+\d+\s*\+?\s*pips?|\+?\s*\d+\s*\+\s*pips?|\d+\s*pips?\s*profit|\d+\s*pips?\s*done|profit\s+done)\b/i.test(normalized.originalText) ||
                          /\b(XAUUSD|GOLD|GBPUSD|EURUSD|US30|GER30)\s+(BUY|SELL|LONG|SHORT)\b[\s\S]{0,50}\b(?:\+\d+\+?\s*pips?|\d+\+\s*pips?|\+?\d+\+?\s*pips?\s*running|\+?\d+\+?\s*pips?\s*(?:profit|done|gain))\b/i.test(normalized.originalText);

  // Check payment screenshots / proofs
  const hasMedia = Boolean(rawMessage.hasMedia || rawMessage.mediaType || reasons.hasMedia);
  const containsPaymentKeywords = /\b(?:payment|deposit|proof|screenshot|receipt|transfer|sent|joined|join vip|vip access|registered|deposit done)\b/i.test(normalized.originalText);
  const isPaymentScreenshotPromo = hasMedia && containsPaymentKeywords;

  let classification;

  if (hasResultPhrase) {
    classification = "RESULT_SIGNAL";
  } else if (isSignal) {
    // Dominance Rule: Signals override promo keywords
    classification = "NEW_SIGNAL";
  } else if (containsPromoKeywords || isPaymentScreenshotPromo) {
    classification = "PROMO";
  } else {
    const teaserPatterns = [
      /shared\s+in\s+(?:the\s+)?VIP/i,
      /claim\s+your\s+spot/i,
      /unlock\s+all\s+(?:the\s+)?trades/i,
      /premium\s+members/i,
      /signal\s+sent\s+to\s+VIP/i,
      /click\s+here/i,
      /buy\s+or\s+sell/i
    ];
    const isTeaser = teaserPatterns.some((pattern) => pattern.test(normalized.originalText));
    
    classification = isTeaser ? "PROMO" : getClassification(reasons, text);
  }

  // Complete Trade Setup Dominance Rule (Double check override)
  if (isSignal && !hasResultPhrase) {
    classification = "NEW_SIGNAL";
  }

  if (classification === "NEW_SIGNAL" && !isSignal) {
    const explicitUpdatePattern = /\b(CANCEL|DELETE SETUP|IGNORE SETUP|CLOSE TRADE|EXIT TRADE|CANCELLED|TRAIL SL|TRAIL STOP|MOVE SL|MOVE STOP|MOVE STOPLOSS|MOVE STOP LOSS)\b/;
    const hasGenericUpdate = (/^[^\w]*\bUPDATE\b/i.test(text) || /\bUPDATE\s*:/i.test(text));
    
    if (explicitUpdatePattern.test(text) || hasGenericUpdate || reasons.updateScore >= 1) {
      classification = "UPDATE_SIGNAL";
    } else if (isPromoByKeywords(normalized.originalText) || reasons.promoScore >= 1 || /WIN\s*RATE|ACCURACY|VIP|SUBSCRIBE|JOIN\s*NOW/i.test(normalized.originalText)) {
      classification = "PROMO";
    } else if (reasons.marketAnalysisScore >= 1 || /PREDICT|FORECAST|OUTLOOK|COMMENTARY|ANALYSIS|BIAS|CONFIRMATION|PATTERN|LAYERS|LOOKS\s*LIKE|FOLLOWERS/i.test(normalized.originalText)) {
      classification = "MARKET_ANALYSIS";
    } else if (reasons.newsScore >= 1) {
      classification = "NEWS";
    } else {
      classification = "NOISE";
    }
  }

  return createResult(classification, normalized, reasons, parsed);
}

function isValidActiveSignal(parsed, rawMessage) {
  if (rawMessage?.channel && String(rawMessage.channel).startsWith("fixture-")) {
    return true;
  }
  if (!parsed.pair || !parsed.action) return false;

  const hasEntry = (parsed.entry !== null && parsed.entry !== undefined) || (parsed.entryRange && parsed.entryRange.length > 0);
  const hasTP = (parsed.targets && parsed.targets.length > 0) || (parsed.pipTargets && parsed.pipTargets.length > 0) || parsed.isOpenTarget;
  const hasSL = (parsed.stopLoss !== null && parsed.stopLoss !== undefined) || parsed.hiddenStopLoss;

  const paramCount = (hasEntry ? 1 : 0) + (hasTP ? 1 : 0) + (hasSL ? 1 : 0);

  if (paramCount < 2) {
    return false;
  }

  // Fast-path: if it has both entry and TP, it's accepted without checking promo/analysis keywords
  if (hasEntry && hasTP) {
    return true;
  }

  // If partial (e.g. has Entry + SL or TP + SL, but missing TP or Entry), check for analysis/promo indicators
  const text = String(rawMessage.text || "").toUpperCase();

  const analysisIndicators = [
    "PREDICTION", "PREDICT", "FORECAST", "OUTLOOK", "COMMENTARY", "ANALYSIS", "BIAS", "OPINION"
  ];
  const hasAnalysisKeywords = analysisIndicators.some(kw => text.includes(kw));

  const promoIndicators = [
    "WIN RATE", "ACCURACY", "VIP PRIVILEGES", "SUBSCRIBE", "JOIN NOW", "SIGNALS A DAY", "WINRATE"
  ];
  const hasPromoKeywords = promoIndicators.some(kw => text.includes(kw));

  if (hasAnalysisKeywords || hasPromoKeywords) {
    return false;
  }

  return true;
}

function createResult(classification, normalized, reasons, parsed) {
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
    parsed: parsed || null,
  };
}

function getClassification(reasons, text = "") {
  const explicitCancelPattern = /\b(CANCEL|CANCELLED|CANCELED|DELETE|IGNORE)\b/i;
  if (explicitCancelPattern.test(text)) {
    return "CANCEL_SIGNAL";
  }

  const explicitUpdatePattern = /\b(CLOSE TRADE|EXIT TRADE|TRAIL SL|TRAIL STOP|MOVE SL|MOVE STOP|MOVE STOPLOSS|MOVE STOP LOSS)\b/;
  
  const hasGenericUpdate = (/^[^\w]*\bUPDATE\b/i.test(text) || /\bUPDATE\s*:/i.test(text)) &&
                           reasons.marketAnalysisScore < 2 &&
                           !(reasons.hasTradingPair && reasons.hasAction && reasons.signalScore >= 3);

  const isExplicitUpdate = explicitUpdatePattern.test(text) || hasGenericUpdate;

  if (isExplicitUpdate) {
    if (reasons.resultScore >= 2 && reasons.resultScore >= reasons.updateScore) {
      return "RESULT_SIGNAL";
    }
    return "UPDATE_SIGNAL";
  }

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

  if (/\b(PARTIAL\s+(PROFIT|PROFITS|CLOSE)|SECURE\s+PARTIAL|TAKE\s+SOME\s+PROFITS?|TAKE\s+PROFITS|TAKE\s+PARTIAL|BOOK\s+\d{1,3}\s*%)\b/.test(text)) {
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
