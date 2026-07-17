import { logger } from "../utils/logger.js";
import { config } from "../config/env.js";
import { classifyMessage } from "../parsers/noiseFilter.js";
import { parseSignalMessage } from "../parsers/signalParser.js";
import { updatePairStateFromSignal, getPairState } from "./pairStateEngine.js";
import { getActiveOpportunities } from "./activeOpportunityService.js";
import { evaluateDecision } from "./decisionEngine.js";
import { evaluateRisk } from "./riskEngine.js";
import { calculatePositionSize } from "./positionSizingService.js";
import { validateTrade } from "./tradeValidationEngine.js";
import { generateExecutionRequest } from "./tradeExecutionEngine.js";
import { translateToMt5Payload } from "./mt5ExecutionAdapter.js";

/**
 * Deep freezes an object recursively to guarantee immutability.
 * @param {Object} obj - Target object
 * @returns {Object} Frozen object
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  Object.keys(obj).forEach((key) => {
    deepFreeze(obj[key]);
  });
  return obj;
}

/**
 * Executes the complete pipeline from Telegram ingestion to MT5 payload generation.
 * @param {Object} rawMessage - Ingested message text and metadata
 * @param {Object} options - Override parameters and mocks
 * @returns {Object} Deep-frozen integration report snapshot
 */
export async function executePipelineE2E(rawMessage = {}, options = {}) {
  const now = options.now || Date.now();
  const overallStart = Date.now();
  const steps = [];

  const report = {
    status: "SUCCESS",
    ingestedMessageText: rawMessage.text || "",
    parsedSignal: null,
    riskAssessment: null,
    positionSizing: null,
    validationResult: null,
    mt5Payload: null,
    pipelineLatencyMs: 0,
    steps,
    timestamp: new Date(now).toISOString(),
    errors: []
  };

  try {
    // 1. Noise Filtering & Parsing
    const parseStart = Date.now();
    const classificationRes = classifyMessage(rawMessage);
    const parsedSignal = parseSignalMessage(rawMessage, "NEW_SIGNAL");
    steps.push({
      step: "INGESTION_AND_PARSING",
      status: "SUCCESS",
      latencyMs: Date.now() - parseStart
    });

    if (classificationRes.classification !== "NEW_SIGNAL") {
      report.status = "BLOCKED";
      report.errors.push(`Filtered out as noise/promo: ${classificationRes.classification}`);
      return finishReport(report, overallStart);
    }

    report.parsedSignal = parsedSignal;

    // 2. State Engine Update
    const stateStart = Date.now();
    const pairState = updatePairStateFromSignal(parsedSignal, new Date(now));
    steps.push({
      step: "PAIR_STATE_UPDATE",
      status: "SUCCESS",
      latencyMs: Date.now() - stateStart
    });

    // Resolve active opportunities and pricing snapshots
    const activeOpportunities = options.mockActiveOpportunities || 
                                getActiveOpportunities().map(o => o.pair);
    
    // Ensure the current pair is listed as active for testing
    if (parsedSignal.pair && !activeOpportunities.includes(parsedSignal.pair)) {
      activeOpportunities.push(parsedSignal.pair);
    }

    const marketPrice = options.mockMarketPrice || {
      price: parsedSignal.entry || 2000,
      status: "HEALTHY",
      source: "MOCK"
    };

    // EXECUTION MODE ROUTER
    if (config.executionMode === "signal_validation") {
      const { executeSignalValidationPipeline } = await import("./signalValidationPipeline.js");
      const validationReport = await executeSignalValidationPipeline(rawMessage, parsedSignal, options);
      steps.push({
        step: "SIGNAL_VALIDATION_ROUTER",
        status: "SUCCESS",
        latencyMs: Date.now() - overallStart
      });
      report.signalValidationReport = validationReport;
      return finishReport(report, overallStart);
    }

    // 3. Decision Evaluation
    const decisionStart = Date.now();
    const decision = await evaluateDecision(
      parsedSignal.pair,
      pairState,
      activeOpportunities,
      marketPrice,
      { now }
    );
    steps.push({
      step: "DECISION_EVALUATION",
      status: "SUCCESS",
      latencyMs: Date.now() - decisionStart
    });

    if (decision.decision === "HOLD") {
      report.status = "BLOCKED";
      report.errors.push("Decision Engine resolved to HOLD state.");
      return finishReport(report, overallStart);
    }

    // 4. Risk Assessment
    const riskStart = Date.now();
    const riskAssessment = evaluateRisk(decision, { now });
    steps.push({
      step: "RISK_ASSESSMENT",
      status: "SUCCESS",
      latencyMs: Date.now() - riskStart
    });

    report.riskAssessment = riskAssessment;

    if (riskAssessment.isValidStructure === false || riskAssessment.riskGrade === "INVALID") {
      report.status = "BLOCKED";
      report.errors.push("Risk Engine rejected order structure or RRR limits.");
      return finishReport(report, overallStart);
    }

    // 5. Position Sizing
    const sizingStart = Date.now();
    const accountState = options.accountState || { balance: 10000, maxRiskPercent: 1.0, maxLotLimit: 10.0 };
    const positionSizing = calculatePositionSize(decision, riskAssessment, accountState, { now });
    steps.push({
      step: "POSITION_SIZING",
      status: "SUCCESS",
      latencyMs: Date.now() - sizingStart
    });

    report.positionSizing = positionSizing;

    // 6. Trade Validation Check
    const validationStart = Date.now();
    const validationResult = validateTrade(
      decision,
      riskAssessment,
      positionSizing,
      { now, rejectHighRisk: options.rejectHighRisk }
    );
    steps.push({
      step: "TRADE_VALIDATION",
      status: "SUCCESS",
      latencyMs: Date.now() - validationStart
    });

    report.validationResult = validationResult;

    if (validationResult.isValid === false) {
      report.status = "BLOCKED";
      report.errors.push(`Trade Validation Engine rejected setup: ${validationResult.rejectionReason}`);
      return finishReport(report, overallStart);
    }

    // 7. Generate Execution Request
    const execStart = Date.now();
    const executionRequest = generateExecutionRequest(
      validationResult,
      decision,
      riskAssessment,
      positionSizing,
      { now }
    );
    steps.push({
      step: "EXECUTION_REQUEST_GENERATION",
      status: "SUCCESS",
      latencyMs: Date.now() - execStart
    });

    if (executionRequest.status !== "APPROVED") {
      report.status = "BLOCKED";
      report.errors.push(`Trade Execution Engine rejected: ${executionRequest.rejectionReason}`);
      return finishReport(report, overallStart);
    }

    // 8. Translate to MT5 Broker Payload
    const adapterStart = Date.now();
    const adapterResult = translateToMt5Payload(executionRequest, { now });
    steps.push({
      step: "MT5_PAYLOAD_SERIALIZATION",
      status: "SUCCESS",
      latencyMs: Date.now() - adapterStart
    });

    if (adapterResult.status !== "TRANSLATED") {
      report.status = "BLOCKED";
      report.errors.push(`MT5 Execution Adapter rejected payload: ${adapterResult.errors.join(", ")}`);
      return finishReport(report, overallStart);
    }

    report.mt5Payload = adapterResult.payload;

  } catch (err) {
    logger.error("e2e_pipeline.failed", { error: err.message });
    report.status = "FAILED";
    report.errors.push(`Pipeline exception encountered: ${err.message}`);
    steps.push({
      step: "PIPELINE_ORCHESTRATOR",
      status: "FAILED",
      latencyMs: Date.now() - overallStart
    });
  }

  return finishReport(report, overallStart);
}

function finishReport(report, startTime) {
  report.pipelineLatencyMs = Date.now() - startTime;
  return deepFreeze(report);
}
