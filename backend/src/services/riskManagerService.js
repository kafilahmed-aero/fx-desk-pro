import crypto from "crypto";
import mongoose from "mongoose";
import { isMarketClosed } from "./tradingSessionService.js";
import { getCachedPrice } from "./priceCacheService.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { RISK_MANAGER_POLICY as riskPolicy } from "../config/riskManagerPolicy.js";
import { PhoenixRiskAudit } from "../models/phoenixRiskAuditModel.js";
import { phoenixDeepFreeze } from "./phoenixFeatureEngine.js";

// Offline Cache Map for Risk Audits
export const localPhoenixRiskAudits = new Map();

/**
 * Validates a trade execution request against the 9 predefined safety rules in order.
 * 
 * @param {Object} executionRequest - Standard request payload
 * @param {Object} options - Override parameters (e.g., mock stats)
 * @returns {Promise<Object>} Verification audit result
 */
export async function validateTradeRequest(executionRequest = {}, options = {}) {
  const now = options.now || new Date();
  const timeframeStart = new Date(now).setHours(0, 0, 0, 0); // Start of today

  const pair = executionRequest.symbol || "XAUUSD";
  const direction = executionRequest.action || "BUY";
  const lotSize = executionRequest.volume || 0.1;
  const entryPrice = executionRequest.entry || 2000.00;
  
  // Extract mock values from options or default
  const mockBalance = options.balance || 10000.00;
  const mockMarginUsed = options.marginUsed || 0.00;
  const mockSpread = options.spread !== undefined ? options.spread : 1.2;

  const evaluations = [];
  let isRejected = false;
  let rejectionReason = null;

  // Fetch active DB positions and features (using fallback caches if MongoDB is offline)
  const isMongoConnected = mongoose.connection.readyState === 1;
  let activeDbTrades = [];
  let dailyDbTrades = [];

  if (isMongoConnected) {
    activeDbTrades = await AiRecommendationOutcome.find({
      simulationMode: "DEMO",
      status: "ACTIVE",
      executionState: "POSITION_OPEN"
    });

    dailyDbTrades = await AiRecommendationOutcome.find({
      simulationMode: "DEMO",
      createdAt: { $gte: new Date(timeframeStart) }
    });
  } else {
    // Fallback: Read from local caches or mock array in options
    activeDbTrades = options.mockActiveTrades || options.mockActivePositions || [];
    dailyDbTrades = options.mockDailyTrades || [];
  }

  // 1. Trading Enabled Gate
  const g1Pass = riskPolicy.tradingEnabled === true;
  evaluations.push({
    gate: "Trading Enabled",
    status: g1Pass ? "PASS" : "FAIL",
    observed: riskPolicy.tradingEnabled,
    threshold: true,
    reason: g1Pass ? "System auto-trading is enabled." : "Trading is disabled in risk policy."
  });
  if (!g1Pass && !isRejected) {
    isRejected = true;
    rejectionReason = "TRADING_DISABLED";
  }

  // 2. Market Open Gate
  const g2Closed = isMarketClosed(now);
  const g2Pass = g2Closed === false;
  evaluations.push({
    gate: "Market Open",
    status: g2Pass ? "PASS" : "FAIL",
    observed: g2Closed ? "Closed" : "Open",
    threshold: "Open",
    reason: g2Pass ? "Trading session is active." : "Market is currently closed (weekend gating)."
  });
  if (!g2Pass && !isRejected) {
    isRejected = true;
    rejectionReason = "MARKET_CLOSED";
  }

  // 3. Maximum Open Positions Gate
  const openCount = activeDbTrades.length;
  const g3Pass = openCount < riskPolicy.maxOpenPositions;
  evaluations.push({
    gate: "Maximum Open Positions",
    status: g3Pass ? "PASS" : "FAIL",
    observed: openCount,
    threshold: riskPolicy.maxOpenPositions,
    reason: g3Pass 
      ? `Active positions count (${openCount}) is below the limit of ${riskPolicy.maxOpenPositions}.`
      : `Active positions limit reached (${openCount}/${riskPolicy.maxOpenPositions}).`
  });
  if (!g3Pass && !isRejected) {
    isRejected = true;
    rejectionReason = "MAX_POSITIONS_EXCEEDED";
  }

  // 4. Duplicate Position Check Gate
  const hasDuplicate = activeDbTrades.some(t => t.pair === pair && t.direction === direction);
  const g4Pass = !hasDuplicate;
  evaluations.push({
    gate: "Duplicate Position Check",
    status: g4Pass ? "PASS" : "FAIL",
    observed: hasDuplicate ? "Duplicate Present" : "None",
    threshold: "None",
    reason: g4Pass ? "No matching active positions in same direction." : `An active position for ${pair} ${direction} already exists.`
  });
  if (!g4Pass && !isRejected) {
    isRejected = true;
    rejectionReason = "DUPLICATE_POSITION";
  }

  // 5. Spread Check Gate
  const g5Pass = mockSpread <= riskPolicy.maxSpreadPoints;
  evaluations.push({
    gate: "Spread Check",
    status: g5Pass ? "PASS" : "FAIL",
    observed: `${mockSpread} points`,
    threshold: `${riskPolicy.maxSpreadPoints} points`,
    reason: g5Pass 
      ? `Current spread (${mockSpread}) is within allowable bounds.`
      : `Spread (${mockSpread}) exceeds maximum threshold of ${riskPolicy.maxSpreadPoints}.`
  });
  if (!g5Pass && !isRejected) {
    isRejected = true;
    rejectionReason = "EXCESSIVE_SPREAD";
  }

  // 6. Lot Size Validation Gate
  const g6Pass = lotSize >= riskPolicy.minVolume && lotSize <= riskPolicy.maxVolume;
  evaluations.push({
    gate: "Lot Size Validation",
    status: g6Pass ? "PASS" : "FAIL",
    observed: lotSize,
    threshold: `${riskPolicy.minVolume} to ${riskPolicy.maxVolume}`,
    reason: g6Pass
      ? `Lot size ${lotSize} is within allowed broker parameters.`
      : `Lot size ${lotSize} is out of bounds (${riskPolicy.minVolume} to ${riskPolicy.maxVolume}).`
  });
  if (!g6Pass && !isRejected) {
    isRejected = true;
    rejectionReason = "INVALID_LOT_SIZE";
  }

  // 7. Margin Availability Gate
  // Leverage assumes 100: Required Margin = Volume * EntryPrice * ContractSize (100) / Leverage -> Margin = Volume * EntryPrice
  const requiredMargin = lotSize * entryPrice;
  const freeMargin = mockBalance - mockMarginUsed;
  const marginRatio = requiredMargin / mockBalance;
  const maxAllowedMarginRatio = 1.0 - riskPolicy.minRequiredMarginRatio;
  const g7Pass = requiredMargin <= freeMargin && marginRatio <= maxAllowedMarginRatio;
  evaluations.push({
    gate: "Margin Availability",
    status: g7Pass ? "PASS" : "FAIL",
    observed: `Margin: ${requiredMargin.toFixed(2)} USD (Ratio: ${(marginRatio * 100).toFixed(1)}%)`,
    threshold: `Max Ratio: ${(maxAllowedMarginRatio * 100).toFixed(1)}%`,
    reason: g7Pass
      ? "Account has sufficient margin and maintains the required safety buffer."
      : "Insufficient margin or safety buffer is violated."
  });
  if (!g7Pass && !isRejected) {
    isRejected = true;
    rejectionReason = "INSUFFICIENT_MARGIN";
  }

  // 8. Symbol Validation Gate
  const symbolAllowed = riskPolicy.allowedSymbols.includes(String(pair).toUpperCase().trim());
  const g8Pass = symbolAllowed === true;
  evaluations.push({
    gate: "Symbol Validation",
    status: g8Pass ? "PASS" : "FAIL",
    observed: pair,
    threshold: riskPolicy.allowedSymbols.join(", "),
    reason: g8Pass ? `Symbol ${pair} is approved for trading.` : `Symbol ${pair} is not in the allowed list.`
  });
  if (!g8Pass && !isRejected) {
    isRejected = true;
    rejectionReason = "INVALID_SYMBOL";
  }

  // 9. Daily Risk Limits Gate
  const dailyTradesCount = dailyDbTrades.length;
  // Calculate daily net loss
  const dailyLoss = dailyDbTrades.reduce((sum, t) => {
    const profit = t.result?.netProfit || 0;
    return profit < 0 ? sum + Math.abs(profit) : sum;
  }, 0);
  const g9Pass = dailyTradesCount < riskPolicy.maxDailyTrades && dailyLoss < riskPolicy.maxDailyLoss;
  evaluations.push({
    gate: "Daily Risk Limits",
    status: g9Pass ? "PASS" : "FAIL",
    observed: `Trades: ${dailyTradesCount}, Loss: ${dailyLoss.toFixed(2)} USD`,
    threshold: `Max Trades: ${riskPolicy.maxDailyTrades}, Max Loss: ${riskPolicy.maxDailyLoss} USD`,
    reason: g9Pass
      ? "Daily trade counts and drawdown levels are safe."
      : `Daily limits exceeded (Trades: ${dailyTradesCount}/${riskPolicy.maxDailyTrades}, Loss: ${dailyLoss.toFixed(2)}/${riskPolicy.maxDailyLoss}).`
  });
  if (!g9Pass && !isRejected) {
    isRejected = true;
    rejectionReason = "DAILY_LIMITS_EXCEEDED";
  }

  const decision = isRejected ? "REJECTED" : "APPROVED";
  const recommendationId = executionRequest.recommendationId || `REC-MOCK-${Date.now()}`;
  
  const hash = crypto.createHash("sha256")
    .update(`${recommendationId}:${decision}:${rejectionReason}:${now.getTime()}`)
    .digest("hex")
    .substring(0, 12);
  const auditId = `AUDIT-RISK-${hash}`;

  const auditPayload = {
    auditId,
    recommendationId,
    policyVersion: riskPolicy.policyVersion,
    decision,
    reason: rejectionReason,
    timestamp: now,
    evaluations
  };

  return phoenixDeepFreeze(auditPayload);
}

/**
 * Saves a risk audit record to Mongoose database or local Cache Map.
 * 
 * @param {Object} auditRecord - Audit payload
 * @returns {Promise<Object>} Saved record
 */
export async function saveRiskAuditToLedger(auditRecord = {}) {
  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    const newDoc = new PhoenixRiskAudit(auditRecord);
    const saved = await newDoc.save();
    return phoenixDeepFreeze(saved.toObject());
  } else {
    const frozen = phoenixDeepFreeze({ ...auditRecord });
    localPhoenixRiskAudits.set(auditRecord.auditId, frozen);
    return frozen;
  }
}

/**
 * Exposes read-only queries for risk audits.
 */
export async function getRiskAudits(filter = {}, options = {}) {
  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    const query = PhoenixRiskAudit.find(filter);
    if (options.sort) query.sort(options.sort);
    if (options.limit) query.limit(options.limit);
    if (options.skip) query.skip(options.skip);
    
    const docs = await query.exec();
    return phoenixDeepFreeze(docs.map(doc => doc.toObject()));
  } else {
    let list = Array.from(localPhoenixRiskAudits.values());
    
    Object.keys(filter).forEach(key => {
      list = list.filter(item => item[key] === filter[key]);
    });

    if (options.limit) {
      list = list.slice(0, options.limit);
    }
    return phoenixDeepFreeze(list);
  }
}
