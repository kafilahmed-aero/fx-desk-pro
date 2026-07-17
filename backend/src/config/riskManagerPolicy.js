/**
 * Policy configurations for the Phoenix Risk Manager.
 * Modifying these parameters dynamically updates risk limits without modifying service logic.
 */
export const RISK_MANAGER_POLICY = {
  policyVersion: "1.0",
  tradingEnabled: true,
  
  // Account Constraints
  maxOpenPositions: 3,
  maxSpreadPoints: 5.0,                  // Maximum allowable spread in Gold USD/points
  allowedSymbols: ["XAUUSD"],
  
  // Sizing Limits
  minVolume: 0.01,
  maxVolume: 5.00,
  minRequiredMarginRatio: 0.15,          // Requires at least 15% free margin buffer
  
  // Daily Drawdown Constraints
  maxDailyTrades: 10,
  maxDailyLoss: 500.00                   // Maximum daily loss limit in USD
};
