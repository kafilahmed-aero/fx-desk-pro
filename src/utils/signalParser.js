export const mockTelegramMessages = [
  "GOLD BUY\nEntry: 2368.40\nTarget: 2395.00\nConfidence: 82%",
  "EURUSD SELL @ 1.0842 TP 1.0785 confidence 61%",
  "Signal: GBPUSD BUY | Entry 1.2690 | Target 1.2765 | Score 55%",
  "USDJPY SELL\nEntry price 156.84\nTarget price 155.90\nConfidence score 73%",
];

const SIGNAL_PATTERN = /\b(BUY|SELL)\b/i;
const PAIR_PATTERN = /\b(GOLD|XAUUSD|EURUSD|GBPUSD|USDJPY|USDCHF|USDCAD|AUDUSD|NZDUSD)\b/i;
const ENTRY_PATTERN = /(?:entry|entry price|@)\s*:?\s*([0-9]+(?:\.[0-9]+)?)/i;
const TARGET_PATTERN = /(?:target|target price|tp)\s*:?\s*([0-9]+(?:\.[0-9]+)?)/i;
const CONFIDENCE_PATTERN = /(?:confidence|confidence score|score)\s*:?\s*([0-9]{1,3})%?/i;

export const parseSignalType = (message) => {
  const match = message.match(SIGNAL_PATTERN);
  return match ? match[1].toUpperCase() : null;
};

export const extractPairName = (message) => {
  const match = message.match(PAIR_PATTERN);
  return match ? match[1].toUpperCase() : null;
};

export const extractEntryPrice = (message) => {
  const match = message.match(ENTRY_PATTERN);
  return match ? match[1] : null;
};

export const extractTargetPrice = (message) => {
  const match = message.match(TARGET_PATTERN);
  return match ? match[1] : null;
};

export const extractConfidenceScore = (message) => {
  const match = message.match(CONFIDENCE_PATTERN);
  return match ? Number(match[1]) : null;
};

export const normalizeSignal = ({
  pair,
  signal,
  entry,
  target,
  confidence,
  source = "telegram",
}) => ({
  pair,
  signal,
  confidence,
  entry,
  target,
  time: "Just now",
  color: signal === "BUY" ? "green" : "red",
  status: "Active",
  source,
});

export const parseSignalMessage = (message) => {
  const signal = parseSignalType(message);
  const pair = extractPairName(message);
  const entry = extractEntryPrice(message);
  const target = extractTargetPrice(message);
  const confidence = extractConfidenceScore(message);

  if (!signal || !pair || !entry || !target || confidence === null) {
    return null;
  }

  return normalizeSignal({
    pair,
    signal,
    entry,
    target,
    confidence,
  });
};

// Future Telegram integration:
// 1. A frontend-safe service can receive message text from a backend endpoint.
// 2. Each raw Telegram message should pass through parseSignalMessage().
// 3. Parsed signals should be normalized into the same shape used by the dashboard.
// 4. The dashboard can then render Telegram-derived signals without UI changes.
// Real Telegram API access should stay in a backend layer to protect credentials.
