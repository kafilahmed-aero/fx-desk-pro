const emojiAndSymbolsPattern = /[^\w\s./:@+\-%#]/g;
const repeatedSymbolPattern = /([+/@:\-.#])\1{2,}/g;

// Normalization keeps both a compact searchable string and line boundaries.
// Telegram formatting is chaotic, so parsers should consume this shape instead
export function normalizeMessageText(text = "") {
  const originalText = String(text || "");
  let cleaned = originalText
    .normalize("NFKC")
    .replace(/\r\n/g, "\n");

  // Split combined pair/action tokens (e.g. Xauusd_Buy, XAUUSD-SELL, XAUUSD:BUY, XAUUSD|BUY)
  cleaned = cleaned
    .replace(/\b([a-zA-Z0-9]{3,8})[_:\-|](BUY|SELL|LONG|SHORT)\b/gi, "$1 $2")
    .replace(/\b(BUY|SELL|LONG|SHORT)[_:\-|]([a-zA-Z0-9]{3,8})\b/gi, "$1 $2");

  // Support shorthand slash range notation (e.g. 4042/40 -> 4042-4040, 3986/83 -> 3986-3983)
  cleaned = cleaned.replace(/\b(\d{1,4})(\d{2})\s*\/\s*(\d{2})\b/g, "$1$2-$1$3");

  // Clean out promotional deposit messages
  cleaned = cleaned.replace(/\b(?:minimum\s+)?deposit\s+\d+(?:\.\d+)?\b/gi, " ");

  // Clean out percentages (e.g. 76% win rate, or any standalone \d%)
  cleaned = cleaned.replace(/\b\d+(?:\.\d+)?\s*%/g, " ");

  // Clean out risk-reward and leverage ratios (e.g. 1:2 RR, 1:3000 leverage)
  cleaned = cleaned.replace(/\b\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?\s*(?:RR|RISK\s*REWARD|RISK\s*:\s*REWARD|LEVERAGE|LEV)\b/gi, " ");

  const cleanedText = cleaned
    .replace(/[|_]+/g, " ")
    .replace(/(\d),(?=\d{3}(?:\.\d+)?(?:\D|$))/g, "$1")
    .replace(/(?<=\d),(?=\d)/g, ".")
    .replace(/,/g, " ")
    .replace(repeatedSymbolPattern, "$1")
    .replace(/#+/g, " ")
    .replace(emojiAndSymbolsPattern, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = cleanedText
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const upperLines = lines.map((line) => line.toUpperCase());
  const lowerLines = lines.map((line) => line.toLowerCase());
  const compactText = upperLines.join(" ").replace(/\s+/g, " ").trim();
  const normalizedText = lowerLines.join(" ").replace(/\s+/g, " ").trim();

  return {
    originalText,
    cleanedText,
    normalizedText,
    compactText,
    lines,
    upperLines,
    lowerLines,
    hasText: compactText.length > 0,
    textLength: originalText.length,
    lineCount: lines.length,
  };
}

export function createMessageFingerprint(channel, messageId) {
  return `${channel || "unknown"}:${messageId || "unknown"}`;
}
