/**
 * Training policy configuration for Phoenix Machine Learning Intelligence Layer.
 */
export const ML_TRAINING_POLICY = {
  policyVersion: "1.0",
  minTrades: 15,
  minFeatureCoverage: 0.90, // 90% completeness of features
  
  // Dataset Diversity Constraints (Minimum unique categories required)
  minSessionDiversity: 2,
  minEntryTypeDiversity: 2,
  minOutcomeDiversity: 2,
  minGradeDiversity: 2,

  // K Nearest Neighbors setting
  kNeighbors: 3
};
