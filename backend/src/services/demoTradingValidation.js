import { logger } from "../utils/logger.js";
import { executePipelineE2E } from "./pipelineIntegration.js";

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
 * Validates if the client connection metadata represents a demo environment.
 * @param {Object} clientMetadata - Client account parameters
 * @returns {Object} Validation outcome { isDemo: boolean, reason: string | null }
 */
export function validateAccountType(clientMetadata = {}) {
  const broker = String(clientMetadata.broker || "").trim().toLowerCase();
  const server = String(clientMetadata.server || "").trim().toLowerCase();
  const tradeMode = String(clientMetadata.tradeMode || "").trim().toLowerCase();

  const validationNotes = [];

  if (!broker) {
    validationNotes.push("Broker name is missing.");
  }
  if (!server) {
    validationNotes.push("Server name is missing.");
  }

  // Safety filter rule: both broker and server MUST contain the case-insensitive keyword "demo"
  if (broker && !broker.includes("demo")) {
    validationNotes.push(`Live account indicator detected in broker name: ${clientMetadata.broker}`);
  }
  if (server && !server.includes("demo")) {
    validationNotes.push(`Live account indicator detected in server name: ${clientMetadata.server}`);
  }

  // Safety check: tradeMode must NOT represent real or live accounts
  if (tradeMode === "real" || tradeMode === "live") {
    validationNotes.push("Explicit live/real trade mode detected.");
  }

  if (validationNotes.length > 0) {
    return {
      isDemo: false,
      reason: "LIVE_ACCOUNT_DETECTED",
      notes: validationNotes
    };
  }

  return {
    isDemo: true,
    reason: null,
    notes: ["Demo account verified successfully."]
  };
}

/**
 * Orchestrates safety validation and runs the E2E pipeline for demo accounts only.
 * @param {Object} rawMessage - Input message payload
 * @param {Object} clientMetadata - Client account parameters
 * @param {Object} options - Override parameters and mocks
 * @returns {Object} Deep-frozen demo validation report
 */
export async function executeDemoValidation(rawMessage = {}, clientMetadata = {}, options = {}) {
  const now = options.now || Date.now();

  const report = {
    status: "SUCCESS",
    accountType: "DEMO",
    broker: clientMetadata.broker || "UNKNOWN",
    server: clientMetadata.server || "UNKNOWN",
    accountNumber: clientMetadata.accountNumber || "UNKNOWN",
    pipelineReport: null,
    validationNotes: [],
    timestamp: new Date(now).toISOString()
  };

  try {
    // 1. Safety Check (Must occur BEFORE any downstream processing)
    const safetyRes = validateAccountType(clientMetadata);
    report.validationNotes = safetyRes.notes;

    if (safetyRes.isDemo === false) {
      logger.warn("demo_validation.live_account_blocked", { clientMetadata });
      report.status = "BLOCKED";
      report.accountType = "LIVE_BLOCKED";
      return deepFreeze(report);
    }

    // 2. Execute pipeline integration (for demo accounts only)
    const pipelineReport = await executePipelineE2E(rawMessage, options);
    report.pipelineReport = pipelineReport;

    if (pipelineReport.status === "BLOCKED") {
      report.status = "BLOCKED";
    } else if (pipelineReport.status === "FAILED") {
      report.status = "FAILED";
    }

  } catch (err) {
    logger.error("demo_validation.failed", { error: err.message });
    report.status = "FAILED";
    report.validationNotes.push(`Validation exception: ${err.message}`);
  }

  return deepFreeze(report);
}
