const emojiAndSymbolsPattern = /[^\w\s./:@+\-%#]/g;
const repeatedSymbolPattern = /([+/@:\-.#])\1{2,}/g;

// Normalization keeps both a compact searchable string and line boundaries.
// Telegram formatting is chaotic, so parsers should consume this shape instead
// of assuming one strict message layout.
export function normalizeMessageText(text = "") {
  const originalText = String(text || "");
  const cleanedText = originalText
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
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
