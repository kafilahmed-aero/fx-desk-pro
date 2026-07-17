/**
 * Policy configurations for the Phoenix Auto-Tuning Safety Engine.
 * Modifying these parameters updates the validation thresholds dynamically.
 */
export const AUTO_TUNING_POLICY = {
  minSampleSize: 10,
  minConfidenceLevels: ["HIGH", "VERY HIGH"],
  minObservationPeriodHours: 72, // 3 days
  minWinRateThreshold: 0.70,
  maxLossRateThreshold: 0.40
};
