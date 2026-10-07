import { isExpiredTestSignal } from "./testSignalExpiry.js";

export const consensusSignalStates = new Set(["ACTIVE", "PARTIAL"]);

export function getSignalStateTransition(signal) {
  const classification = signal?.parserClassification || signal?.classification;

  if (classification === "CANCEL_SIGNAL") {
    return "CANCELLED";
  }

  if (classification === "RESULT_SIGNAL") {
    if (signal.resultAction?.type === "TARGET_HIT") {
      return "PARTIAL";
    }

    return "CLOSED";
  }

  if (classification === "UPDATE_SIGNAL") {
    if (
      signal.managementAction === "CLOSE_TRADE" ||
      signal.managementAction === "CANCEL_SIGNAL"
    ) {
      return "CLOSED";
    }

    if (signal.managementAction === "CLOSE_PARTIAL") {
      return "PARTIAL";
    }

    return "ACTIVE";
  }

  return null;
}

export function canAffectConsensus(signal) {
  const hasEntry = (signal?.entry !== null && signal?.entry !== undefined) || (signal?.entryRange && signal?.entryRange.length > 0);
  const hasTP = (signal?.targets && signal?.targets.length > 0) || (signal?.pipTargets && signal?.pipTargets.length > 0) || (signal?.target !== null && signal?.target !== undefined);
  const hasSL = (signal?.stopLoss !== null && signal?.stopLoss !== undefined) || (signal?.effectiveStopLoss !== null && signal?.effectiveStopLoss !== undefined) || signal?.hiddenStopLoss;

  return consensusSignalStates.has(signal?.signalState) && !signal?.possibleDuplicate && Boolean(hasEntry && hasTP && hasSL);
}

export function shouldExpireSignal(signal, expirationAgeMinutes, now = new Date()) {
  if (!canAffectConsensus(signal)) {
    return false;
  }

  if (isExpiredTestSignal(signal, now)) {
    return true;
  }

  return (
    Number(signal?.freshnessWeight) === 0 ||
    Number(signal?.ageMinutes) >= expirationAgeMinutes
  );
}
