import crypto from "crypto";

const signatureNumberPattern = /\b\d{1,6}(?:\.\d{1,5})?\b/g;

export function createDedupeFoundation(signal) {
  const signatureParts = [
    signal.pair || "unknown-pair",
    signal.action || "unknown-action",
    signal.entry ?? "no-entry",
    signal.stopLoss ?? "no-sl",
    (signal.targets || []).join("-") || "no-targets",
  ];
  const semanticSignature = signatureParts.join("|");
  const textSignature = createTextSignature(signal.normalizedText || signal.rawText || "");

  return {
    semanticSignature,
    textSignature,
    clusterKey: signal.pair ? `${signal.pair}:${signal.action || "UNKNOWN"}` : null,
    duplicateCheckReady: Boolean(signal.pair || signal.normalizedText),
  };
}



export function createUpdateContextFoundation(signal) {
  const canLink =
    signal.parserClassification === "UPDATE_SIGNAL" ||
    signal.parserClassification === "RESULT_SIGNAL";

  return {
    linkStatus: canLink ? "PENDING_MATCH" : "SOURCE_SIGNAL",
    candidateCorrelationKey: signal.correlationKey,
    matchedSignalId: null,
    matchConfidence: null,
    matchingVersion: "foundation-v1",
  };
}

function createTextSignature(text) {
  const normalized = String(text)
    .toLowerCase()
    .replace(signatureNumberPattern, "#")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  return crypto.createHash("sha1").update(normalized).digest("hex");
}
