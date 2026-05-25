const activeStates = new Set(["ACTIVE", "PARTIAL"]);
const duplicateWindowMs = 90 * 60 * 1000;
const minimumDuplicateScore = 0.92;

const entryTolerances = {
  XAUUSD: 2,
  BTCUSD: 150,
  US30: 25,
  NAS100: 25,
  USDJPY: 0.15,
  AUDJPY: 0.15,
};

export function enrichPossibleDuplicate(signal, activeSignals = []) {
  const bestMatch = findBestDuplicateMatch(signal, activeSignals);

  if (!bestMatch) {
    return {
      ...signal,
      possibleDuplicate: false,
      duplicateMatch: null,
    };
  }

  return {
    ...signal,
    possibleDuplicate: true,
    duplicateMatch: {
      channel: bestMatch.signal.channel,
      messageId: bestMatch.signal.messageId,
      score: bestMatch.score,
      reasons: bestMatch.reasons,
    },
  };
}

export function findBestDuplicateMatch(signal, activeSignals = []) {
  if (!isDuplicateCandidate(signal)) {
    return null;
  }

  return activeSignals
    .map((candidate) => ({
      signal: candidate,
      ...scoreDuplicateMatch(signal, candidate),
    }))
    .filter((match) => match.score >= minimumDuplicateScore)
    .sort((left, right) => right.score - left.score)[0] || null;
}

export function scoreDuplicateMatch(signal, candidate) {
  if (!isDuplicateCandidate(candidate) || sameStoredSignal(signal, candidate)) {
    return {
      score: 0,
      reasons: [],
    };
  }

  const reasons = [];
  let score = 0;

  if (signal.pair === candidate.pair) {
    score += 0.35;
    reasons.push("same_pair");
  } else {
    return { score: 0, reasons };
  }

  if (signal.action === candidate.action) {
    score += 0.25;
    reasons.push("same_action");
  } else {
    return { score: 0, reasons };
  }

  const entryScore = getEntryScore(signal, candidate);
  if (entryScore === 0) {
    return { score: 0, reasons };
  }

  score += entryScore * 0.25;
  reasons.push("near_entry");

  const timeScore = getTimeScore(signal, candidate);
  if (timeScore === 0) {
    return { score: 0, reasons };
  }

  score += timeScore * 0.15;
  reasons.push("near_timestamp");

  return {
    score: Number(score.toFixed(3)),
    reasons,
  };
}

export function getConsensusCountableSignals(signals = []) {
  return signals.filter((signal) => !signal.possibleDuplicate);
}

function isDuplicateCandidate(signal) {
  return (
    signal?.pair &&
    ["BUY", "SELL"].includes(signal.action) &&
    getPrimaryEntry(signal) !== null &&
    activeStates.has(signal.signalState || signal.signalStatus) &&
    (signal.parserClassification || signal.classification) === "NEW_SIGNAL"
  );
}

function sameStoredSignal(signal, candidate) {
  return (
    signal.channel &&
    candidate.channel &&
    signal.messageId !== null &&
    signal.messageId !== undefined &&
    candidate.messageId !== null &&
    candidate.messageId !== undefined &&
    signal.channel === candidate.channel &&
    signal.messageId === candidate.messageId
  );
}

function getEntryScore(signal, candidate) {
  const entry = getPrimaryEntry(signal);
  const candidateEntry = getPrimaryEntry(candidate);

  if (entry === null || candidateEntry === null) {
    return 0;
  }

  const tolerance = getEntryTolerance(signal.pair, entry);
  const distance = Math.abs(entry - candidateEntry);

  if (distance > tolerance) {
    return 0;
  }

  return 1 - distance / Math.max(tolerance, Number.EPSILON);
}

function getTimeScore(signal, candidate) {
  const time = getSignalTime(signal);
  const candidateTime = getSignalTime(candidate);

  if (time === null || candidateTime === null) {
    return 0;
  }

  const distance = Math.abs(time - candidateTime);

  if (distance > duplicateWindowMs) {
    return 0;
  }

  return 1 - distance / duplicateWindowMs;
}

function getEntryTolerance(pair, entry) {
  return entryTolerances[pair] ?? Math.max(Math.abs(entry) * 0.0005, 0.0008);
}

function getPrimaryEntry(signal) {
  if (Number.isFinite(Number(signal.entry))) {
    return Number(signal.entry);
  }

  const rangeEntry = signal.entryRange?.find((value) => Number.isFinite(Number(value)));
  return rangeEntry === undefined ? null : Number(rangeEntry);
}

function getSignalTime(signal) {
  const parsed = new Date(signal.createdAt || signal.timestamp || 0).getTime();
  return Number.isNaN(parsed) || parsed === 0 ? null : parsed;
}
