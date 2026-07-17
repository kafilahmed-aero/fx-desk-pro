/**
 * Configuration thresholds and policies for the Phoenix Position Manager.
 */
export const POSITION_MANAGER_POLICY = {
  // Price distance thresholds in USD (XAUUSD points)
  breakEvenTriggerDistance: 1.50,       // 15 pips equivalent for Gold
  partialTpTriggerDistance: 2.00,       // 20 pips equivalent for Gold
  partialTpCloseRatio: 0.50,            // Close 50% of the lot size
  trailingStartDistance: 2.50,          // 25 pips equivalent for Gold
  trailingDistance: 1.50,               // Trail by 15 pips distance for Gold
  
  // Holding time constraints
  maxHoldingTimeMinutes: 240            // 4 hours time exit
};
