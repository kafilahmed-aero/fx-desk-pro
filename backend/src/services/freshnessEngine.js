export function calculateSignalFreshness(signal, now = new Date()) {
  const ageMinutes = calculateAgeMinutes(signal?.timestamp, now);
  const freshness = getFreshnessByAge(ageMinutes);

  return {
    ageMinutes,
    freshnessWeight: freshness.weight,
    freshnessLevel: freshness.level,
  };
}

function calculateAgeMinutes(timestamp, now) {
  const parsed = timestamp ? new Date(timestamp) : null;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return 0;
  }

  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 60000));
}

function getFreshnessByAge(ageMinutes) {
  if (ageMinutes <= 15) {
    return {
      weight: 1.0,
      level: "VERY_FRESH",
    };
  }

  if (ageMinutes <= 45) {
    return {
      weight: 0.85,
      level: "FRESH",
    };
  }

  if (ageMinutes <= 90) {
    return {
      weight: 0.70,
      level: "ACTIVE",
    };
  }

  if (ageMinutes <= 180) {
    return {
      weight: 0.50,
      level: "AGING",
    };
  }

  if (ageMinutes <= 360) {
    return {
      weight: 0.30,
      level: "WEAK",
    };
  }

  return {
    weight: 0.10,
    level: "STALE",
  };
}
