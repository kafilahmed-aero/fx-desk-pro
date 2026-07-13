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
  return consensusSignalStates.has(signal?.signalState) && !signal?.possibleDuplicate;
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
