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
  if (ageMinutes <= 5) {
    return {
      weight: 1,
      level: "VERY_FRESH",
    };
  }

  if (ageMinutes <= 15) {
    return {
      weight: 0.8,
      level: "FRESH",
    };
  }

  if (ageMinutes <= 30) {
    return {
      weight: 0.5,
      level: "AGING",
    };
  }

  if (ageMinutes < 60) {
    return {
      weight: 0.2,
      level: "WEAK",
    };
  }

  return {
    weight: 0,
    level: "STALE",
  };
}
