import { getConsensusSummary } from "../services/consensusService.js";
import { storeParsedSignal } from "../services/parsedSignalStore.js";

const now = new Date().toISOString();

await seedSignal({ pair: "XAUUSD", action: "BUY", messageId: 1 });
await seedSignal({ pair: "XAUUSD", action: "BUY", entry: 105, messageId: 2 });
await seedSignal({ pair: "XAUUSD", action: "BUY", entry: 101, messageId: 3 });
await seedSignal({
  pair: "XAUUSD",
  action: "BUY",
  entry: 101.25,
  messageId: 9,
  rawText: "Gold buy now 101.25",
  normalizedText: "GOLD BUY NOW 101.25",
});
await seedSignal({ pair: "XAUUSD", action: "SELL", messageId: 4 });
await seedSignal({
  pair: "XAUUSD",
  action: "SELL",
  freshnessScore: "STALE",
  messageId: 5,
});
await seedSignal({ pair: "EURUSD", action: "BUY", messageId: 6 });
await seedSignal({ pair: "EURUSD", action: "SELL", messageId: 7 });
await seedSignal({
  pair: "BTCUSD",
  action: "BUY",
  signalState: "CLOSED",
  messageId: 8,
});

const summary = await getConsensusSummary({ limit: 20, latestLimit: 2 });
const errors = [];
const xauusd = summary.find((pairSummary) => pairSummary.pair === "XAUUSD");
const eurusd = summary.find((pairSummary) => pairSummary.pair === "EURUSD");
const btcusd = summary.find((pairSummary) => pairSummary.pair === "BTCUSD");

assertEqual(errors, "XAUUSD consensus", xauusd?.consensus, "BUY");
assertEqual(errors, "XAUUSD buySignals", xauusd?.buySignals, 3);
assertEqual(errors, "XAUUSD sellSignals", xauusd?.sellSignals, 1);
assertEqual(errors, "XAUUSD duplicateSignals", xauusd?.duplicateSignals, 1);
assertEqual(errors, "XAUUSD confidence", xauusd?.confidence, 75);
assertEqual(errors, "XAUUSD latest limit", xauusd?.latestActiveSignals.length, 2);
assertEqual(errors, "EURUSD consensus", eurusd?.consensus, "NEUTRAL");
assertEqual(errors, "EURUSD confidence", eurusd?.confidence, 50);
assertEqual(errors, "BTCUSD excluded", btcusd, undefined);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }

  process.exitCode = 1;
} else {
  console.log("Consensus summary smoke test passed");
}

async function seedSignal(overrides) {
  await storeParsedSignal({
    pair: overrides.pair,
    action: overrides.action,
    entry: overrides.entry ?? 100,
    entryRange: [overrides.entry ?? 100],
    target: null,
    targets: [],
    pipTargets: [],
    stopLoss: null,
    hiddenStopLoss: false,
    channel: "consensus-test",
    messageId: overrides.messageId,
    timestamp: now,
    createdAt: now,
    rawText: overrides.rawText || "",
    normalizedText: overrides.normalizedText || "",
    extractionConfidence: overrides.extractionConfidence ?? 1,
    classification: "NEW_SIGNAL",
    parserClassification: "NEW_SIGNAL",
    signalState: overrides.signalState || "ACTIVE",
    signalStatus: overrides.signalStatus || "ACTIVE",
    freshnessScore: overrides.freshnessScore || "VERY_FRESH",
    freshnessWeight: overrides.freshnessWeight ?? 1,
    missingFields: [],
    parseWarnings: [],
    textStats: {},
  });
}

function assertEqual(errors, field, actual, expected) {
  if (actual !== expected) {
    errors.push(`${field}: expected ${expected}, received ${actual}`);
  }
}
