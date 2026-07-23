import { normalizeMessageText } from "./messageNormalizer.js";
import { createPairTokenPattern, detectTradingPair, detectRawPair, normalizePair, RECOGNIZED_ASSETS } from "./pairDetector.js";
import { logger } from "../utils/logger.js";

const numberPattern = "\\d{1,6}(?:\\.\\d{1,5})?";
const numberRegex = new RegExp(numberPattern, "g");
const pipWordPattern = /(?:\b|(?<=\d))PIPS?\b/i;
const expectedNewSignalFields = ["pair", "action", "entry", "targets", "stopLoss"];

const CHANNEL_DEFAULT_PAIRS = {
  "arixanderxx7": "XAUUSD"
};

// Rules-based extraction for noisy Telegram messages. Every field is optional:
// partial signals are useful input for later consensus, so malformed messages
// should become low-confidence records instead of parser crashes.
export function parseSignalMessage(rawMessage = {}, parserClassification = "NEW_SIGNAL", options = {}) {
  try {
    const normalized = runNormalizationStage(rawMessage);
    const entities = runEntityExtractionStage(normalized);

    // Apply channel-specific default pair if no pair is detected
    if ((!entities.pair || entities.pair === "unknown") && rawMessage.channel && CHANNEL_DEFAULT_PAIRS[rawMessage.channel]) {
      entities.pair = CHANNEL_DEFAULT_PAIRS[rawMessage.channel];
    }



    // Hardened Dynamic Validation (Issue 10): filter out indices, ratios, and invalid low values globally
    if (entities.pair && entities.pair !== "unknown") {
      const isForex = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY", "EURGBP", "EURJPY", "GBPJPY"].includes(entities.pair);
      
      const isInvalidValue = (val) => {
        if (val === null || val === undefined || val === "OPEN") return false;
        const num = Number(val);
        if (!Number.isFinite(num)) return false;
        
        // Rule A: Whole integers <= 10 are always garbage/pollution (e.g. indices or ratios)
        if (Number.isInteger(num) && num <= 10) return true;
        
        // Rule B: Low values <= 10 for non-forex assets are invalid (except low-priced assets like NATGAS)
        const isLowPriceAsset = isForex || entities.pair === "NATGAS";
        if (!isLowPriceAsset && num <= 10) return true;
        
        return false;
      };

      if (isInvalidValue(entities.entryInfo.entry)) {
        entities.entryInfo.entry = null;
      }
      if (entities.entryInfo.entryRange) {
        entities.entryInfo.entryRange = entities.entryInfo.entryRange.filter(v => !isInvalidValue(v));
      }
      if (entities.targets) {
        entities.targets = entities.targets.filter(v => !isInvalidValue(v));
      }
      if (isInvalidValue(entities.stopLoss)) {
        entities.stopLoss = null;
      }
    }

    const hasPair = !!entities.pair && entities.pair !== "unknown";
    const hasAction = !!entities.action;
    const hasEntry = (entities.entryInfo.entry !== null && entities.entryInfo.entry !== undefined) || (entities.entryInfo.entryRange && entities.entryInfo.entryRange.length > 0);
    const hasTP = (entities.targets && entities.targets.length > 0) || (entities.pipTargets && entities.pipTargets.length > 0);
    const hasSL = (entities.stopLoss !== null && entities.stopLoss !== undefined) || entities.hiddenStopLoss;

    const isEligible = hasPair && hasAction && hasEntry && hasTP && hasSL;
    let finalClassification = parserClassification;
    if (parserClassification === "NEW_SIGNAL" && !isEligible) {
      finalClassification = "NOISE";
    }

    const interpretation = runSignalInterpretationStage(
      entities,
      rawMessage,
      finalClassification
    );
    const confidence = runConfidenceScoringStage(
      entities,
      interpretation,
      normalized,
      finalClassification
    );

    const isOpenTarget = entities.targets.includes("OPEN");
    const filteredTargets = entities.targets.filter((t) => t !== "OPEN" && typeof t === "number");

    const parsedSignal = {
      pair: entities.pair === "unknown" ? null : entities.pair,
      action: entities.action,
      orderType: entities.orderType,
      bias: entities.bias,
      entry: entities.entryInfo.entry,
      entryRange: entities.entryInfo.entryRange,
      target: filteredTargets[0] || null,
      targets: filteredTargets,
      pipTargets: entities.pipTargets,
      stopLoss: entities.stopLoss,
      hiddenStopLoss: entities.hiddenStopLoss,
      timeframe: entities.timeframe,
      isOpenTarget,
      timestamp: rawMessage.timestamp || null,
      createdAt: interpretation.freshness.createdAt,
      channel: rawMessage.channel || "unknown",
      messageId: rawMessage.messageId || null,
      rawText: normalized.originalText,
      normalizedText: normalized.normalizedText,
      extractionConfidence: confidence.extractionConfidence,
      parserClassification: finalClassification,
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

    if (parserClassification === "NEW_SIGNAL") {
      const missingFields = [];
      if (!parsedSignal.channel || parsedSignal.channel === "unknown") missingFields.push("channel");
      if (!parsedSignal.pair) missingFields.push("pair");
      if (!parsedSignal.action) missingFields.push("action");
      if (parsedSignal.entry === null || parsedSignal.entry === undefined) missingFields.push("entry");
      if (!parsedSignal.targets || parsedSignal.targets.length === 0) missingFields.push("targets");
      if (parsedSignal.stopLoss === null || parsedSignal.stopLoss === undefined) missingFields.push("stopLoss");

      if (missingFields.length > 0) {
        logger.warn("parser_partial_signal", {
          channel: parsedSignal.channel,
          missingFields,
        });
      }
    }

    return parsedSignal;
  } catch (error) {
    return createParserFailure(rawMessage, parserClassification, error);
  }
}

function runNormalizationStage(rawMessage) {
  return normalizeMessageText(rawMessage.text);
}

function runEntityExtractionStage(normalized) {
  const pair = extractPair(normalized.cleanedText);
  const bias = extractBias(normalized.compactText);
  let action = extractAction(normalized.compactText, bias);
  const orderType = extractOrderType(normalized.compactText);
  const entryInfo = extractEntry(normalized, action);
  const stopLoss = extractStopLoss(normalized);
  const pipTargets = extractPipTargets(normalized.compactText);
  const targets = extractTargets(normalized.cleanedText, action, entryInfo, stopLoss);

  if (!action && entryInfo && typeof entryInfo.entry === "number") {
    const entry = entryInfo.entry;
    if (typeof stopLoss === "number" && stopLoss !== entry) {
      action = stopLoss > entry ? "SELL" : "BUY";
    } else if (Array.isArray(targets) && targets.length > 0 && typeof targets[0] === "number") {
      action = targets[0] < entry ? "SELL" : "BUY";
    }
  }

  return {
    pair,
    bias: bias || (action === "BUY" ? "BULLISH" : action === "SELL" ? "BEARISH" : null),
    action,
    orderType,
    entryInfo,
    pipTargets,
    targets,
    stopLoss,
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
  const rawPair = detectRawPair(text);

  if (rawPair) {
    const pair = normalizePair(rawPair, true);
    if (pair && RECOGNIZED_ASSETS.has(pair)) {
      logger.debug("parser.pair_detected", { pair });
      return pair;
    }
  }

  return "unknown";
}

function extractAction(text, bias = null) {
  if (/\b(BUY|LONG)\b/.test(text) || createCompactActionPattern("BUY").test(text) || /\bBIAS\s*[-–—]?\s*BULLISH\b/i.test(text)) {
    return "BUY";
  }

  if (/\b(SELL|SHORT)\b/.test(text) || createCompactActionPattern("SELL").test(text) || /\bBIAS\s*[-–—]?\s*BEARISH\b/i.test(text)) {
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

function extractOrderType(text) {
  if (/\b(?:BUY|SELL|LONG|SHORT)?\s*LIMIT\b/i.test(text)) {
    return "LIMIT";
  }
  if (/\b(?:BUY|SELL|LONG|SHORT)?\s*STOP\b/i.test(text)) {
    return "STOP";
  }
  if (/\b(?:BUY|SELL|LONG|SHORT)\s+(?:NOW|NOW\s*@|@?\s*CMP|CMP)\b/i.test(text) || /\b(?:MARKET)\s+(?:BUY|SELL|ORDER|EXECUTION)\b/i.test(text)) {
    return "MARKET";
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
  const pairPattern = createPairTokenPattern().source;
  const pairPrefix = `(?:\\s*#?\\s*(?:${pairPattern}))?`;
  const labeledPatterns = [
    new RegExp(`\\b(?:ENT(?:RY|RIES)?\\s*ZONE|ZONE|ENT(?:RY|RIES)?)\\s*[1-9]\\b\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*(?://|[-/]|TO)\\s*(${numberPattern}))?`, "i"),
    new RegExp(`\\b(?:BUY|SELL|LONG|SHORT)?\\s*ZONE\\b\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*(?://|[-/])\\s*(${numberPattern}))?`, "i"),
    new RegExp(`\\b(?:BUY|SELL|LONG|SHORT)\\s+NOW\\b\\s*@?\\s*${pairPrefix}\\s*@?\\s*(${numberPattern})(?:\\s*(?://|[-/])\\s*(${numberPattern}))?`, "i"),
    new RegExp(`\\bENT(?:RY|RIES)?\\b\\s*(?:ZONE|PRICE|AREA|POINT|LEVEL)?\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*(?://|[-/])\\s*(${numberPattern}))?`, "i"),
    new RegExp(`\\b(?:CURRENT\\s+PRICE|CMP)\\b\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*(?://|[-/])\\s*(${numberPattern}))?`, "i"),
    new RegExp(`\\b(?:BUY|SELL|LONG|SHORT)\\s+(?:LIMIT|STOP)\\b\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*(?://|[-/])\\s*(${numberPattern}))?`, "i"),
    new RegExp(`(?:(?:${pairPattern})\\s*\\b(?:BUY|SELL|LONG|SHORT)\\b|\\b(?:BUY|SELL|LONG|SHORT)\\b\\s*(?:${pairPattern}))\\s*@?\\s*(${numberPattern})(?:\\s*(?://|[-/])\\s*(${numberPattern}))?`, "i"),
    new RegExp(`\\b(?:PIVOT\\s+LEVEL|PIVOT\\s+POINT|KEY\\s+LEVEL|PSYCHOLOGICAL\\s+LEVEL|MARKET\\s+IS\\s+TRADING\\s+ON|PRICE\\s+IS\\s+COILING\\s+AROUND|INSTRUMENT\\s+TESTS|ASSET\\s+IS\\s+APPROACHING)\\b\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*(?://|[-/])\\s*(${numberPattern}))?`, "i"),
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
    actionLine.split(/\b(TP\d*|TARGET\d*|TAKE PROFIT\d*|SL|STOP LOSS)\b/)[0]
  );
  const numbers = extractNumbers(entrySegment);
  const entry = numbers[0] || null;
  const entryRange = getEntryRangeFromLine(entrySegment, numbers, entry);
  return {
    entry,
    entryRange,
  };
}

function extractTargets(text, action = null, entryInfo = null, stopLoss = null) {
  const cleanedText = String(text || "").replace(/\b\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*%/g, " ");
  const targets = [];
  const groupedTargets = cleanedText.match(/(?:(?<!\.)\b\d{1,2}\s*[_.]?\s*)?\b(TP|TARGETS?|TAKE PROFITS?)(?:\d{1,2})?\b[\s\S]{0,80}/gi) || [];

  for (const group of groupedTargets) {
    if (containsPipTarget(group)) {
      continue;
    }

    const safeGroup = group
      .split(/\n\s*\n/)[0]
      .split(/(?:https?:\/\/|www\.|t\.me)/i)[0]
      .split(/\b(SL|STOP LOSS|ENTRY|ENTRIES|TIME\s*FRAME|TIMEFRAME|TF)\b/i)[0];
    for (const value of extractTargetNumbers(safeGroup)) {
      addUniqueNumber(targets, value);
    }
  }

  const directPatterns = [
    new RegExp(`\\bTP\\s*(?:\\d{1,2})?\\b(?:[\\s:@-]|\\.{2,})+\\s*(${numberPattern})`, "gi"),
    new RegExp(`(?<!\\.)\\b\\d{1,2}\\s*[_.]?\\s*TP\\b(?:[\\s:@-]|\\.{2,})*\\s*(${numberPattern})`, "gi"),
    new RegExp(`(?<!\\.)\\b\\d{1,2}\\s*[_.]?\\s*TARGET\\b(?:[\\s:@-]|\\.{2,})*\\s*(${numberPattern})`, "gi"),
    new RegExp(`\\bTP\\s*(?:\\d{1,2})?\\b\\s*@?\\s*[:@-]?\\s*(${numberPattern})`, "gi"),
    new RegExp(`\\bTAKE\\s+PROFITS?\\s*(?:\\d{1,2})?\\b\\s*@?\\s*[:@-]?\\s*(${numberPattern})`, "gi"),
    new RegExp(`\\bTARGETS?\\s*(?:\\d{1,2})?\\b\\s*@?\\s*[:@-]?\\s*(${numberPattern})`, "gi"),
    new RegExp(`\\bGOAL\\s*(?:\\d{1,2})?\\b\\s*[:@-]?\\s*(${numberPattern})`, "gi"),
  ];

  for (const pattern of directPatterns) {
    collectPatternNumbers(cleanedText, pattern, targets, {
      skipPipTargets: true,
    });
  }

  collectOpenTargets(cleanedText, targets);

  // Unlabeled multi-line targets fallback
  if (targets.length === 0 && action && entryInfo) {
    const entry = entryInfo.entry;
    const entryRange = entryInfo.entryRange;
    const unlabeled = extractUnlabeledTargets(cleanedText, action, entry, stopLoss, entryRange);
    for (const val of unlabeled) {
      addUniqueNumber(targets, val);
    }
  }

  return targets;
}

function extractUnlabeledTargets(text, action, entry, stopLoss, entryRange) {
  if (!action || entry === null || stopLoss === null) {
    return [];
  }

  const targets = [];
  const lines = text.split("\n");
  const numberRegex = new RegExp(numberPattern, "g");

  for (const line of lines) {
    if (/\b(?:SL|STOP\s*LOSS|STOPLOSS|ENTRY|ENTRIES|CMP|CURRENT|RISK|RISK\s+PRICE)\b/i.test(line)) {
      continue;
    }

    const matches = [...line.matchAll(numberRegex)]
      .map((m) => toNumber(m[0]))
      .filter((n) => n !== null);

    for (const num of matches) {
      if (num === entry || num === stopLoss) {
        continue;
      }

      if (entryRange && entryRange.length > 0) {
        if (entryRange.includes(num)) {
          continue;
        }
        if (entryRange.length === 2 && num >= entryRange[0] && num <= entryRange[1]) {
          continue;
        }
      }

      if (action === "BUY") {
        if (num > entry && num < entry * 1.5) {
          addUniqueTarget(targets, num);
        }
      } else if (action === "SELL") {
        if (num < entry && num > entry * 0.5) {
          addUniqueTarget(targets, num);
        }
      }
    }
  }

  return targets;
}

function extractPipTargets(text) {
  const pipTargets = [];
  const pipGroups = text.match(/\b(TP|TARGETS?|TAKE PROFITS?)(?:\d{1,2})?\b[\s\S]{0,45}(?:\b|(?<=\d))PIPS?\b/gi) || [];

  for (const group of pipGroups) {
    for (const value of extractTargetNumbers(group)) {
      addUniqueNumber(pipTargets, value);
    }
  }

  return pipTargets;
}

function extractStopLoss(normalized) {
  const patterns = [
    new RegExp(`\\bSL\\b\\s*[\\s:@.-]+\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bRISK\\s+PRICE\\b\\s*[:@-]?\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bRISK\\b\\s*[:@-]?\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bSL\\b\\s*(?:PRICE)?\\s*[:@-]?\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bSL(?=${numberPattern})\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bSTOP\\s+LOSS\\b\\s*[:@-]?\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bSTOPLOSS\\b\\s*[:@-]?\\s*(${numberPattern})`, "i"),
    new RegExp(`\\b(?:MY|SAFE|RECOMMENDED)\\s+STOP\\s+LOSS\\b\\s*[:@-]?\\s*(${numberPattern})`, "i"),
    new RegExp(`\\bINVALID(?:ATION)?\\b\\s*[:@-]?\\s*(${numberPattern})`, "i"),
  ];

  const val = findFirstNumberByPattern(normalized.compactText, patterns);
  if (val !== null) {
    return val;
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
    /\b(PARTIAL\s+(PROFIT|PROFITS|CLOSE)|SECURE\s+PARTIAL|TAKE\s+SOME\s+PROFITS?|TAKE\s+PROFITS|TAKE\s+PARTIAL|BOOK\s+\d{1,3}\s*%)\b/.test(text)
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

  if (classification === "CANCEL_SIGNAL" || managementAction === "CANCEL_SIGNAL") {
    return "CANCELLED";
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
  if (classification === "CANCEL_SIGNAL" || managementAction === "CANCEL_SIGNAL") {
    return "CANCEL";
  }

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
  if (classification === "CANCEL_SIGNAL" || managementAction === "CANCEL_SIGNAL") {
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
  if (classification === "CANCEL_SIGNAL" || managementAction === "CANCEL_SIGNAL") {
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
  let secondEntry = match[2] ? toNumber(match[2]) : null;

  if (entry !== null && secondEntry !== null && match[2]) {
    secondEntry = reconstructAbbreviatedValue(entry, secondEntry, match[2].trim());
  }

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

    const match = line.match(new RegExp(`@\\s*(${numberPattern})(?:\\s*(?://|[-/])\\s*(${numberPattern}))?`, "i"));
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

  // Identify numbers that are actually target indices (e.g. "TP 1", "TP2", "TARGET 3", "TAKE PROFIT 4")
  const targetIndices = new Set();
  const indexMatches = text.matchAll(/\b(?:TP|TARGET|TAKE PROFIT)\s*(\d{1,2})\b/gi);
  for (const m of indexMatches) {
    const val = parseInt(m[1], 10);
    if (val <= 10) {
      targetIndices.add(val);
    }
  }

  // Filter out target indices (including integers between 1 and 10 globally) from our numbers list
  const filteredNumbers = numbers.filter(n => !(Number.isInteger(n) && (targetIndices.has(n) || (n >= 1 && n <= 10))));

  if (filteredNumbers.length === 0) {
    return [];
  }

  if (isSpacedTargetIndex(text)) {
    const indexedTargets = extractIndexedTargetNumbers(text);
    return indexedTargets.length > 0 ? indexedTargets : filteredNumbers;
  }

  return filteredNumbers;
}


function stripPairTokens(text) {
  return String(text || "").replace(new RegExp(createPairTokenPattern().source, "g"), " ");
}

function extractIndexedTargetNumbers(text) {
  const targets = [];

  const pat1 = new RegExp(`\\b(?:TP|TARGET|TAKE PROFIT)\\s*(\\d{1,2})\\b(?:[\\s:@-]|\\.(?!\\d)|\\.{2,})+\\s*(${numberPattern})`, "gi");
  for (const match of text.matchAll(pat1)) {
    const val = toNumber(match[2]);
    if (val !== null && !(Number.isInteger(val) && val >= 1 && val <= 10)) {
      addUniqueTarget(targets, val);
    }
  }

  const pat2 = new RegExp(`(?<!\\.)\\b(\\d{1,2})\\s*[_.]?\\s*(?:TP|TARGET|TAKE PROFIT)\\b(?:[\\s:@-]|\\.(?!\\d)|\\.{2,})*\\s*(${numberPattern})`, "gi");
  for (const match of text.matchAll(pat2)) {
    const val = toNumber(match[2]);
    if (val !== null && !(Number.isInteger(val) && val >= 1 && val <= 10)) {
      addUniqueTarget(targets, val);
    }
  }

  const legacyPat = new RegExp(`\\b(?:TP|TARGET|TAKE PROFIT)\\s+\\d{1,2}(?!\\d)\\s*(?:[:@-]|\\.(?!\\d))?\\s*(${numberPattern})\\b`, "gi");
  for (const match of text.matchAll(legacyPat)) {
    const val = toNumber(match[1]);
    if (val !== null && !(Number.isInteger(val) && val >= 1 && val <= 10)) {
      addUniqueTarget(targets, val);
    }
  }

  return targets;
}

function isSpacedTargetIndex(text) {
  const hasSpaced = new RegExp(
    `\\b(?:TP|TARGET|TAKE PROFIT)\\s+\\d{1,2}(?!\\d)\\s*(?:[:@-]|\\.(?!\\d))?\\s*(?:${numberPattern}|OPEN\\+?)\\b`,
    "i"
  ).test(text);
  if (hasSpaced) return true;

  const pat1 = new RegExp(`\\b(?:TP|TARGET|TAKE PROFIT)\\s*\\d{1,2}\\b(?:[\\s:@-]|\\.(?!\\d)|\\.{2,})+\\s*${numberPattern}`, "i");
  const pat2 = new RegExp(`(?<!\\.)\\b\\d{1,2}\\s*[_.]?\\s*(?:TP|TARGET|TAKE PROFIT)\\b(?:[\\s:@-]|\\.(?!\\d)|\\.{2,})*\\s*${numberPattern}`, "i");
  return pat1.test(text) || pat2.test(text);
}

function getEntryRangeFromLine(line, numbers, entry) {
  if (entry === null) {
    return [];
  }

  if (numbers.length >= 2) {
    const match = line.match(new RegExp(`(${numberPattern})\\s*(?://|[-/]|TO|AND|\\s)\\s*(${numberPattern})`, "i"));
    if (match) {
      const firstVal = toNumber(match[1]);
      let secondVal = toNumber(match[2]);
      if (firstVal !== null && secondVal !== null) {
        secondVal = reconstructAbbreviatedValue(firstVal, secondVal, match[2].trim());
        return normalizeEntryRange([firstVal, secondVal]);
      }
    }
  }

  return [entry];
}

function reconstructAbbreviatedValue(firstVal, secondVal, secondStr) {
  if (typeof firstVal !== "number" || typeof secondVal !== "number" || !secondStr) {
    return secondVal;
  }

  if (firstVal <= 100) {
    return secondVal;
  }

  const firstIntStr = Math.floor(firstVal).toString();
  const secondIntStr = secondStr.split(".")[0];

  if (secondIntStr.length < firstIntStr.length) {
    const k = secondIntStr.length;
    const factor = Math.pow(10, k);
    const prefixVal = Math.floor(firstVal / factor) * factor;
    const vBase = prefixVal + secondVal;
    
    const c1 = vBase - factor;
    const c2 = vBase;
    const c3 = vBase + factor;
    
    const diff1 = Math.abs(c1 - firstVal);
    const diff2 = Math.abs(c2 - firstVal);
    const diff3 = Math.abs(c3 - firstVal);
    
    const minDiff = Math.min(diff1, diff2, diff3);
    if (minDiff === diff1) return c1;
    if (minDiff === diff2) return c2;
    return c3;
  }

  return secondVal;
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
    if (signal.targets.length > 0 || signal.isOpenTarget) score += 0.15;
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
      return signal.targets.length === 0 && !signal.isOpenTarget;
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
