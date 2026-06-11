import { normalizeMessageText } from "./messageNormalizer.js";
import { createPairTokenPattern, detectTradingPair } from "./pairDetector.js";
import { logger } from "../utils/logger.js";

const numberPattern = "\\d{1,6}(?:\\.\\d{1,5})?";
const numberRegex = new RegExp(numberPattern, "g");
const pipWordPattern = /(?:\b|(?<=\d))PIPS?\b/i;
const expectedNewSignalFields = ["pair", "action", "entry", "targets", "stopLoss"];

// Rules-based extraction for noisy Telegram messages. Every field is optional:
// partial signals are useful input for later consensus, so malformed messages
// should become low-confidence records instead of parser crashes.
export function parseSignalMessage(rawMessage = {}, parserClassification = "NEW_SIGNAL") {
  try {
    const normalized = runNormalizationStage(rawMessage);
    const entities = runEntityExtractionStage(normalized);
    const interpretation = runSignalInterpretationStage(
      entities,
      rawMessage,
      parserClassification
    );
    const confidence = runConfidenceScoringStage(
      entities,
      interpretation,
      normalized,
      parserClassification
    );

    return {
      pair: entities.pair,
      action: entities.action,
      bias: entities.bias,
      entry: entities.entryInfo.entry,
      entryRange: entities.entryInfo.entryRange,
      target: entities.targets.find((targetValue) => typeof targetValue === "number") || null,
      targets: entities.targets,
      pipTargets: entities.pipTargets,
      stopLoss: entities.stopLoss,
      hiddenStopLoss: entities.hiddenStopLoss,
      timeframe: entities.timeframe,
      timestamp: rawMessage.timestamp || null,
      createdAt: interpretation.freshness.createdAt,
      channel: rawMessage.channel || "unknown",
      messageId: rawMessage.messageId || null,
      rawText: normalized.originalText,
      normalizedText: normalized.normalizedText,
      extractionConfidence: confidence.extractionConfidence,
      parserClassification,
      managementAction: entities.managementAction,
      resultAction: entities.resultAction,
      lifecycleEvent: interpretation.lifecycleEvent,
      lifecycleIntent: interpretation.lifecycleIntent,
      signalStatus: interpretation.signalStatus,
      signalState: interpretation.signalState,
      missingFields: confidence.missingFields,
      parseWarnings: confidence.parseWarnings,
      freshnessScore: interpretation.freshness.freshnessScore,
      freshnessWeight: interpretation.freshness.freshnessWeight,
      ageMinutes: interpretation.freshness.ageMinutes,
      correlationKey: createCorrelationKey(entities.pair, entities.action),
      textStats: {
        textLength: normalized.textLength,
        lineCount: normalized.lineCount,
      },
    };
  } catch (error) {
    return createParserFailure(rawMessage, parserClassification, error);
  }
}

function runNormalizationStage(rawMessage) {
  return normalizeMessageText(rawMessage.text);
}

function runEntityExtractionStage(normalized) {
  const pair = extractPair(normalized.compactText);
  const bias = extractBias(normalized.compactText);
  const action = extractAction(normalized.compactText, bias);

  return {
    pair,
    bias,
    action,
    entryInfo: extractEntry(normalized, action),
    pipTargets: extractPipTargets(normalized.compactText),
    targets: extractTargets(normalized.compactText),
    stopLoss: extractStopLoss(normalized),
    hiddenStopLoss: extractHiddenStopLoss(normalized.compactText),
    timeframe: extractTimeframe(normalized.compactText),
    managementAction: extractManagementAction(normalized.compactText),
    resultAction: extractResultAction(normalized.compactText),
  };
}

function runSignalInterpretationStage(entities, rawMessage, parserClassification) {
  const freshness = calculateFreshness(rawMessage.timestamp || rawMessage.fetchedAt);
  const lifecycleEvent = getLifecycleEvent(
    parserClassification,
    entities.managementAction,
    entities.resultAction
  );
  const lifecycleIntent = getLifecycleIntent(
    parserClassification,
    entities.managementAction,
    entities.resultAction
  );
  const signalStatus = getSignalStatus(
    parserClassification,
    entities.managementAction,
    entities.resultAction,
    freshness
  );
  const signalState = getSignalState(
    parserClassification,
    entities.managementAction,
    entities.resultAction
  );

  return {
    freshness,
    lifecycleEvent,
    lifecycleIntent,
    signalStatus,
    signalState,
  };
}

function runConfidenceScoringStage(
  entities,
  interpretation,
  normalized,
  parserClassification
) {
  const signalForScoring = {
    pair: entities.pair,
    action: entities.action,
    bias: entities.bias,
    entry: entities.entryInfo.entry,
    targets: entities.targets,
    pipTargets: entities.pipTargets,
    timeframe: entities.timeframe,
    stopLoss: entities.stopLoss,
    hiddenStopLoss: entities.hiddenStopLoss,
    managementAction: entities.managementAction,
    resultAction: entities.resultAction,
    parserClassification,
  };
  const missingFields = getMissingFields(signalForScoring);
  const parseWarnings = getParseWarnings(normalized, missingFields);
  const extractionConfidence = calculateConfidence({
    ...signalForScoring,
    parseWarnings,
    freshnessWeight: interpretation.freshness.freshnessWeight,
  });

  return {
    missingFields,
    parseWarnings,
    extractionConfidence,
  };
}

function extractPair(text) {
  const pair = detectTradingPair(text);

  if (pair) {
    logger.debug("parser.pair_detected", { pair });
  }

  return pair;
}

function extractAction(text, bias = null) {
  if (/\b(BUY|LONG)\b/.test(text) || createCompactActionPattern("BUY").test(text)) {
    return "BUY";
  }

  if (/\b(SELL|SHORT)\b/.test(text) || createCompactActionPattern("SELL").test(text)) {
    return "SELL";
  }

  if (bias === "BULLISH") {
    return "BUY";
  }

  if (bias === "BEARISH") {
    return "SELL";
  }

  return null;
}

function extractBias(text) {
  if (/\b(BULLISH|UPSIDE|BUYERS IN CONTROL)\b/.test(text)) {
    return "BULLISH";
  }

  if (/\b(BEARISH|DOWNSIDE|SELLERS IN CONTROL)\b/.test(text)) {
    return "BEARISH";
  }

  if (/\bBIAS\b\s*[:@-]?\s*BUY\b/.test(text)) {
    return "BULLISH";
  }

  if (/\bBIAS\b\s*[:@-]?\s*SELL\b/.test(text)) {
    return "BEARISH";
  }

  return null;
}

function extractEntry(normalized, action) {
  const pairPrefix = `(?:\\s*#?\\s*(?:${createPairTokenPattern().source}))?`;
  const labeledPatterns = [
    new RegExp(`\\bENT(?:RY|RIES)?\\b\\s*(?:ZONE|PRICE|AREA|POINT)?\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*[-/]\\s*(${numberPattern}))?`, "i"),
    new RegExp(`\\b(?:CURRENT\\s+PRICE|CMP)\\b\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*[-/]\\s*(${numberPattern}))?`, "i"),
    new RegExp(`\\b(?:BUY|SELL|LONG|SHORT)\\s+(?:LIMIT|STOP)\\b\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*[-/]\\s*(${numberPattern}))?`, "i"),
  ];

  for (const line of normalized.upperLines) {
    for (const pattern of labeledPatterns) {
      const match = line.match(pattern);
      const info = entryFromMatch(match);

      if (info.entry !== null) {
        return info;
      }
    }
  }

  const atEntryInfo = extractAtEntry(normalized);

  if (atEntryInfo.entry !== null) {
    return atEntryInfo;
  }

  if (!action) {
    return {
      entry: null,
      entryRange: [],
    };
  }

  const actionLine = normalized.upperLines.find((line) =>
    /\b(BUY|SELL|LONG|SHORT)\b/.test(line) ||
    createCompactActionPattern("BUY").test(line) ||
    createCompactActionPattern("SELL").test(line)
  );

  if (!actionLine) {
    return {
      entry: null,
      entryRange: [],
    };
  }

  const entrySegment = stripPairTokens(
    actionLine.split(/\b(TP|TARGET|TAKE PROFIT|SL|STOP LOSS)\b/)[0]
  );
  const numbers = extractNumbers(entrySegment);
  const entry = numbers[0] || null;
  const entryRange = getEntryRangeFromLine(entrySegment, numbers, entry);

  return {
    entry,
    entryRange,
  };
}

function extractTargets(text) {
  const cleanedText = String(text || "").replace(/\b\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*%/g, " ");
  const targets = [];
  const groupedTargets = cleanedText.match(/\b(TP|TARGETS?|TAKE PROFITS?)\b[\s\S]{0,80}/gi) || [];

  for (const group of groupedTargets) {
    if (containsPipTarget(group)) {
      continue;
    }

    const safeGroup = group.split(/\b(SL|STOP LOSS|ENTRY|ENTRIES|TIME\s*FRAME|TIMEFRAME|TF)\b/i)[0];
    for (const value of extractTargetNumbers(safeGroup)) {
      addUniqueNumber(targets, value);
    }
  }

  const directPatterns = [
    new RegExp(`\\bTP\\d{1,2}\\b\\s*[:@-]?\\s*(${numberPattern})`, "gi"),
    new RegExp(`\\bTAKE\\s+PROFIT\\d{1,2}\\b\\s*[:@-]?\\s*(${numberPattern})`, "gi"),
    new RegExp(`\\bTAKE\\s+PROFITS\\d{1,2}\\b\\s*[:@-]?\\s*(${numberPattern})`, "gi"),
    new RegExp(`\\bTARGET\\d{1,2}\\b\\s*[:@-]?\\s*(${numberPattern})`, "gi"),
    new RegExp(`\\bGOAL\\b\\s*[:@-]?\\s*(${numberPattern})`, "gi"),
  ];

  for (const pattern of directPatterns) {
    collectPatternNumbers(cleanedText, pattern, targets, {
      skipPipTargets: true,
    });
  }

  collectOpenTargets(cleanedText, targets);

  return targets;
}

function extractPipTargets(text) {
  const pipTargets = [];
  const pipGroups = text.match(/\b(TP|TARGETS?|TAKE PROFITS?)\b[\s\S]{0,45}(?:\b|(?<=\d))PIPS?\b/gi) || [];

  for (const group of pipGroups) {
    for (const value of extractTargetNumbers(group)) {
      addUniqueNumber(pipTargets, value);
    }
  }

  return pipTargets;
}

function extractStopLoss(normalized) {
  const patterns = [
    new RegExp(`\\bSL\\b\\s*(?:PRICE)?\\s*[:@-]?\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bSL(?=${numberPattern})\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bSTOP\\s+LOSS\\b\\s*[:@-]?\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bSTOPLOSS\\b\\s*[:@-]?\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bINVALID(?:ATION)?\\b\\s*[:@-]?\\s*(${numberPattern})`, "i"),
  ];

  for (const line of normalized.upperLines) {
    const val = findFirstNumberByPattern(line, patterns);
    if (val !== null) {
      return val;
    }
  }

  return null;
}

function extractHiddenStopLoss(text) {
  return /\b(SL|STOP LOSS)\b\s*[:@-]?\s*(VIP|HIDDEN|PRIVATE|DM|INBOX|MEMBERS ONLY)\b/.test(text);
}

function extractTimeframe(text) {
  const match = text.match(
    /\b(?:TIME\s*FRAME|TIMEFRAME|TF)\b\s*[:@-]?\s*(M\d+|H\d+|\d+M|\d+H|D1|H4|H1|DAILY|WEEKLY|MONTHLY)\b/
  );

  if (!match?.[1]) {
    return null;
  }

  return normalizeTimeframe(match[1]);
}

function normalizeTimeframe(value) {
  const timeframe = String(value).toUpperCase();

  if (timeframe === "DAILY") {
    return "D1";
  }

  if (timeframe === "WEEKLY") {
    return "W1";
  }

  if (timeframe === "MONTHLY") {
    return "MN1";
  }

  return timeframe;
}

function extractManagementAction(text) {
  if (/\b(CANCEL|CANCELLED|CANCELED|DELETE SETUP|IGNORE SETUP)\b/.test(text)) {
    return "CANCEL_SIGNAL";
  }

  if (/\b(MOVE SL|MOVE STOP|SL TO BE)\b[\s\S]{0,24}\b(BE|BREAKEVEN|BREAK EVEN)\b/.test(text) ||
    /\b(SL|STOP LOSS)\b[\s\S]{0,24}\b(BE|BREAKEVEN|BREAK EVEN)\b/.test(text) ||
    /\b(BREAKEVEN|BREAK EVEN)\b/.test(text)) {
    return "MOVE_SL_BREAKEVEN";
  }

  if (/\b(TRAIL|TRAILING)\b[\s\S]{0,16}\b(SL|STOP)\b/.test(text) || /\bTRAIL SL\b/.test(text)) {
    return "TRAIL_SL";
  }

  if (/\b(MOVE SL|MOVE STOP|SL TO BE|SL TO ENTRY)\b/.test(text)) {
    return "MOVE_SL";
  }

  if (
    /\b(CLOSE PARTIAL|PARTIAL PROFIT|PARTIAL PROFITS|BOOK PROFIT|BOOK PROFITS)\b/.test(text) ||
    /\bBOOK\b[\s\S]{0,24}\b(PARTIAL|PROFIT|PROFITS)\b/.test(text) ||
    /\bCLOSE\s*[\s\S]{0,24}\b(PARTIAL|HALF|PROFIT|PROFITS)\b/.test(text) ||
    /\bCLOSE\s*[\s\S]{0,24}\d{1,3}\s*%/.test(text) ||
    /\b(PARTIAL\s+(PROFIT|PROFITS|CLOSE)|SECURE\s+PARTIAL|TAKE\s+(SOME\s+)?PROFITS?|TAKE\s+PARTIAL|BOOK\s+\d{1,3}\s*%)\b/.test(text)
  ) {
    return "CLOSE_PARTIAL";
  }

  if (/\b(HOLD|HOLDING)\b/.test(text)) {
    return "HOLD";
  }

  if (/\b(CLOSE|EXIT|FULL CLOSE|MANUAL CLOSE)\b[\s\S]{0,24}\b(TRADE|POSITION|ALL|NOW|SETUP|REMAINING|REST|ASAP|EVERYTHING)\b/.test(text)) {
    return "CLOSE_TRADE";
  }

  return null;
}

function extractResultAction(text) {
  const targetMatch = text.match(/\b(?:TP|T\/P|TARGET|TAKE PROFIT)\s*(\d*)\s*(HIT|DONE|REACHED)\b/);

  if (targetMatch) {
    return {
      type: "TARGET_HIT",
      targetIndex: targetMatch[1] ? Number(targetMatch[1]) : null,
    };
  }

  if (/\b(SL|STOP LOSS)\s*(HIT|DONE|REACHED)\b/.test(text)) {
    return {
      type: "STOP_LOSS_HIT",
      targetIndex: null,
    };
  }

  if (/\b(PROFIT BOOKED|WIN(?!\s*RATE)|WON)\b/.test(text)) {
    return {
      type: "PROFIT_BOOKED",
      targetIndex: null,
    };
  }

  return null;
}

function getLifecycleEvent(classification, managementAction, resultAction) {
  if (classification === "NEW_SIGNAL") {
    return "OPENED";
  }

  if (classification === "RESULT_SIGNAL") {
    return resultAction?.type || "RESULT_REPORTED";
  }

  if (classification === "UPDATE_SIGNAL") {
    return managementAction || "UPDATED";
  }

  return null;
}

function getLifecycleIntent(classification, managementAction, resultAction) {
  if (classification === "RESULT_SIGNAL" && resultAction?.type === "TARGET_HIT") {
    return "TP_HIT";
  }

  if (classification === "UPDATE_SIGNAL") {
    if (managementAction === "MOVE_SL_BREAKEVEN") {
      return "BREAKEVEN";
    }

    if (managementAction === "TRAIL_SL") {
      return "TRAIL_STOP";
    }

    if (managementAction === "CLOSE_PARTIAL") {
      return "PARTIAL_CLOSE";
    }

    if (managementAction === "CLOSE_TRADE") {
      return "FULL_CLOSE";
    }

    if (managementAction === "HOLD") {
      return "HOLD";
    }
  }

  return null;
}

function getSignalStatus(classification, managementAction, resultAction, freshness) {
  if (managementAction === "CANCEL_SIGNAL") {
    return "CANCELLED";
  }

  if (classification === "RESULT_SIGNAL") {
    if (resultAction?.type === "STOP_LOSS_HIT") {
      return "CLOSED";
    }

    return resultAction?.type === "TARGET_HIT" ? "PARTIAL" : "CLOSED";
  }

  if (classification === "UPDATE_SIGNAL") {
    if (managementAction === "CLOSE_TRADE") {
      return "CLOSED";
    }

    if (managementAction === "CLOSE_PARTIAL") {
      return "PARTIAL";
    }
  }

  if (freshness.ageMinutes !== null && freshness.ageMinutes > 360) {
    return "EXPIRED";
  }

  return "ACTIVE";
}

function getSignalState(classification, managementAction, resultAction) {
  if (managementAction === "CANCEL_SIGNAL") {
    return "CANCELLED";
  }

  if (classification === "RESULT_SIGNAL") {
    if (resultAction?.type === "STOP_LOSS_HIT") {
      return "CLOSED";
    }

    return resultAction?.type === "TARGET_HIT" ? "PARTIAL" : "CLOSED";
  }

  if (classification === "UPDATE_SIGNAL") {
    if (managementAction === "CLOSE_TRADE") {
      return "CLOSED";
    }

    if (managementAction === "CLOSE_PARTIAL") {
      return "PARTIAL";
    }
  }

  return "ACTIVE";
}

function entryFromMatch(match) {
  if (!match?.[1]) {
    return {
      entry: null,
      entryRange: [],
    };
  }

  const entry = toNumber(match[1]);
  const secondEntry = match[2] ? toNumber(match[2]) : null;

  return {
    entry,
    entryRange: normalizeEntryRange([entry, secondEntry].filter((value) => value !== null)),
  };
}

function extractAtEntry(normalized) {
  for (const line of normalized.upperLines) {
    if (/\b(SL|STOP LOSS|TP|TARGET|TAKE PROFIT)\b/.test(line)) {
      continue;
    }

    const match = line.match(new RegExp(`@\\s*(${numberPattern})(?:\\s*[-/]\\s*(${numberPattern}))?`, "i"));
    const info = entryFromMatch(match);

    if (info.entry !== null) {
      return info;
    }
  }

  return {
    entry: null,
    entryRange: [],
  };
}

function extractTargetNumbers(text) {
  const numbers = extractNumbers(text);

  if (isSpacedTargetIndex(text)) {
    const indexedTargets = extractIndexedTargetNumbers(text);
    return indexedTargets.length > 0 ? indexedTargets : numbers.slice(1);
  }

  return numbers;
}

function stripPairTokens(text) {
  return String(text || "").replace(new RegExp(createPairTokenPattern().source, "g"), " ");
}

function extractIndexedTargetNumbers(text) {
  const indexedTargetPattern = new RegExp(
    `\\b(?:TP|TARGET|TAKE PROFIT)\\s+\\d{1,2}(?!\\d)\\s*[:@-]?\\s*(${numberPattern})\\b`,
    "gi"
  );

  return [...String(text).matchAll(indexedTargetPattern)]
    .map((match) => toNumber(match[1]))
    .filter((value) => value !== null);
}

function isSpacedTargetIndex(text) {
  return new RegExp(
    `\\b(?:TP|TARGET|TAKE PROFIT)\\s+\\d{1,2}(?!\\d)\\s*[:@-]?\\s*(?:${numberPattern}|OPEN\\+?)\\b`,
    "i"
  ).test(text);
}

function getEntryRangeFromLine(line, numbers, entry) {
  if (entry === null) {
    return [];
  }

  if (
    numbers.length >= 2 &&
    new RegExp(`${numberPattern}\\s*[-/]\\s*${numberPattern}`).test(line)
  ) {
    return normalizeEntryRange(numbers.slice(0, 2));
  }

  return [entry];
}

function normalizeEntryRange(values) {
  if (values.length !== 2) {
    return values;
  }

  return [...values].sort((a, b) => a - b);
}

function collectOpenTargets(text, targets) {
  const openTargetPattern = /\b(?:TP|TARGET)\s*\d*\b\s*[:@-]?\s*OPEN\+?\b/gi;

  if (openTargetPattern.test(text)) {
    addUniqueTarget(targets, "OPEN");
  }
}

function collectPatternNumbers(text, pattern, targets, options = {}) {
  for (const match of text.matchAll(pattern)) {
    if (options.skipPipTargets) {
      const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 12);

      if (containsPipTarget(tail)) {
        continue;
      }
    }

    const value = toNumber(match[1]);
    addUniqueTarget(targets, value);
  }
}

function extractNumbers(text) {
  return [...String(text).matchAll(numberRegex)]
    .map((match) => toNumber(match[0]))
    .filter((value) => value !== null);
}

function containsPipTarget(text) {
  return pipWordPattern.test(text);
}

function addUniqueNumber(collection, value) {
  addUniqueTarget(collection, value);
}

function addUniqueTarget(collection, value) {
  if (value !== null && !collection.includes(value)) {
    collection.push(value);
  }
}

function findFirstNumberByPattern(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return toNumber(match[1]);
    }
  }

  return null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function calculateConfidence(signal) {
  let score = 0;

  if (signal.parserClassification === "UPDATE_SIGNAL") {
    if (signal.managementAction) score += 0.45;
    if (signal.pair) score += 0.2;
    if (signal.stopLoss !== null || signal.hiddenStopLoss) score += 0.15;
    if (signal.targets.length > 0) score += 0.1;
    if (signal.action) score += 0.1;
  } else if (signal.parserClassification === "RESULT_SIGNAL") {
    if (signal.resultAction) score += 0.45;
    if (signal.pair) score += 0.2;
    if (signal.targets.length > 0) score += 0.15;
    if (signal.action) score += 0.1;
    if (signal.stopLoss !== null || signal.hiddenStopLoss) score += 0.1;
  } else if (signal.parserClassification === "MARKET_ANALYSIS") {
    if (signal.pair) score += 0.25;
    if (signal.action) score += 0.2;
    if (signal.bias) score += 0.2;
    if (signal.targets.length > 0) score += 0.2;
    if (signal.timeframe) score += 0.15;
  } else {
    if (signal.pair) score += 0.25;
    if (signal.action) score += 0.25;
    if (signal.entry !== null) score += 0.2;
    if (signal.targets.length > 0) score += 0.15;
    if (signal.pipTargets.length > 0) score += 0.1;
    if (signal.stopLoss !== null || signal.hiddenStopLoss) score += 0.15;
  }

  if (signal.parseWarnings.length > 0) {
    score -= Math.min(signal.parseWarnings.length * 0.05, 0.15);
  }

  if (signal.freshnessWeight !== null && signal.parserClassification === "NEW_SIGNAL") {
    score *= 0.7 + signal.freshnessWeight * 0.3;
  }

  return Number(Math.max(0, Math.min(score, 1)).toFixed(2));
}

function getMissingFields(signal) {
  if (signal.parserClassification === "UPDATE_SIGNAL") {
    return ["managementAction"].filter((field) => !signal[field]);
  }

  if (signal.parserClassification === "RESULT_SIGNAL") {
    return ["resultAction"].filter((field) => !signal[field]);
  }

  if (signal.parserClassification === "MARKET_ANALYSIS") {
    return ["pair", "action", "bias", "targets", "timeframe"].filter((field) => {
      if (field === "targets") {
        return signal.targets.length === 0;
      }

      return !signal[field];
    });
  }

  return expectedNewSignalFields.filter((field) => {
    if (field === "targets") {
      return signal.targets.length === 0;
    }

    if (field === "stopLoss" && signal.hiddenStopLoss) {
      return false;
    }

    return signal[field] === null || signal[field] === undefined;
  });
}

function getParseWarnings(normalized, missingFields) {
  const warnings = [];

  if (!normalized.hasText) {
    warnings.push("NO_TEXT");
  }

  if (normalized.lineCount > 12 || normalized.textLength > 700) {
    warnings.push("LONG_NOISY_MESSAGE");
  }

  if (missingFields.length > 0) {
    warnings.push("PARTIAL_EXTRACTION");
  }

  return warnings;
}

function calculateFreshness(timestamp) {
  const parsedTimestamp = timestamp ? new Date(timestamp) : null;
  const createdAt =
    parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) ? parsedTimestamp : new Date();
  const ageMinutes = Math.max(0, Math.round((Date.now() - createdAt.getTime()) / 60000));
  const halfLifeMinutes = 35;
  const freshnessWeight = Math.exp((-Math.log(2) * ageMinutes) / halfLifeMinutes);

  return {
    createdAt: createdAt.toISOString(),
    ageMinutes,
    freshnessScore: getFreshnessScore(ageMinutes),
    freshnessWeight: Number(freshnessWeight.toFixed(3)),
  };
}

function getFreshnessScore(ageMinutes) {
  if (ageMinutes <= 5) {
    return "VERY_FRESH";
  }

  if (ageMinutes <= 20) {
    return "FRESH";
  }

  if (ageMinutes <= 60) {
    return "AGING";
  }

  return "STALE";
}

function createCorrelationKey(pair, action) {
  if (!pair && !action) {
    return null;
  }

  return [pair || "UNKNOWN_PAIR", action || "UNKNOWN_ACTION"].join(":");
}

function createCompactActionPattern(action) {
  return new RegExp(`\\b${action}(?:${createPairTokenPattern().source})\\b`);
}

function createParserFailure(rawMessage, parserClassification, error) {
  return {
    pair: null,
    action: null,
    entry: null,
    entryRange: [],
    target: null,
    targets: [],
    stopLoss: null,
    hiddenStopLoss: false,
    bias: null,
    timeframe: null,
    pipTargets: [],
    timestamp: rawMessage?.timestamp || null,
    createdAt: new Date().toISOString(),
    channel: rawMessage?.channel || "unknown",
    messageId: rawMessage?.messageId || null,
    rawText: String(rawMessage?.text || ""),
    normalizedText: "",
    extractionConfidence: 0,
    parserClassification,
    managementAction: null,
    resultAction: null,
    lifecycleEvent: null,
    lifecycleIntent: null,
    signalStatus: "CANCELLED",
    signalState: "CANCELLED",
    missingFields: expectedNewSignalFields,
    parseWarnings: ["PARSER_EXCEPTION"],
    freshnessScore: null,
    freshnessWeight: null,
    ageMinutes: null,
    correlationKey: null,
    textStats: {
      textLength: String(rawMessage?.text || "").length,
      lineCount: 0,
    },
    parserError: error.message,
  };
}
