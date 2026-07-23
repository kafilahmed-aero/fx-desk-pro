import { logger } from "../utils/logger.js";
import { QuarantinedOrphan } from "../models/quarantinedOrphansModel.js";
import { generateMagicNumber, mt5Events, connectedClients } from "./mt5SyncService.js";

/**
 * Executes a manual reconciliation trigger by requesting positions list from MT5.
 */
export function executeManualReconciliation(accountId) {
  logger.info("reconciliation.manual_trigger_received", { accountId });
  const client = connectedClients.get(accountId);
  if (client && client.ws) {
    client.ws.send(JSON.stringify({ action: "POSITION_LIST" }));
    return true;
  }
  logger.warn("reconciliation.manual_trigger_failed_no_client", { accountId });
  return false;
}

/**
 * Performs a read-first reconciliation scan between live MT5 positions/history and Mongoose.
 * @param {string} accountId - Associated MT5 accountId
 * @param {Array} activePositionsList - Array of live positions
 * @param {Array} closedHistoryList - Array of completed history deals
 * @param {Object} options - Override configurations
 * @returns {Promise<Object>} Reconciliation report object
 */
export async function reconcileValidationStates(accountId, activePositionsList = [], closedHistoryList = [], options = {}) {
  const now = options.now || new Date();
  const reconciliationId = "rec-" + Math.random().toString(36).substring(2, 9) + "-" + Date.now();

  logger.info("reconciliation.starting_scan", { reconciliationId, activeCount: activePositionsList.length, historyCount: closedHistoryList.length });

  // Read-first structures
  const recoveredContexts = [];
  const synchronizedContexts = [];
  const orphanTrades = [];
  const failures = [];

  try {
    // 1. Fetch unresolved validation contexts from MongoDB
    const unresolvedDocs = await SignalValidationContextModel.find({
      $or: [
        { pipelineStatus: { $ne: "COMPLETED" } },
        { "rating.processed": false }
      ]
    });

    // Match contexts by pre-calculating magic numbers
    const docMap = new Map();
    unresolvedDocs.forEach(doc => {
      const magic = generateMagicNumber(String(doc.signalId));
      docMap.set(magic, doc);
    });

    const activeTickets = new Set();
    const updatesBatch = [];

    // 2. Loop through MT5 live active positions
    for (const pos of activePositionsList) {
      const magic = Number(pos.magicNumber || pos.magic);
      const ticket = String(pos.ticket);
      activeTickets.add(ticket);

      const doc = docMap.get(magic);
      if (!doc) {
        // If it looks like a validation magic number (check hash range or match symbol) but no document exists:
        // We log and quarantine it as an orphan
        if (magic > 0) {
          orphanTrades.push({
            ticket,
            magicNumber: magic,
            symbol: pos.symbol,
            account: accountId,
            reason: "NO_MATCHING_VALIDATION_CONTEXT"
          });
        }
        continue;
      }

      // Check timestamps: if Mongoose updated timestamp is newer than MT5 position open time, do not overwrite
      const docUpdated = doc.updatedAt ? new Date(doc.updatedAt) : new Date(0);
      const posOpenTime = pos.openTime ? new Date(pos.openTime) : new Date(0);
      if (docUpdated > posOpenTime && doc.pipelineStatus === "EXECUTED") {
        logger.debug("reconciliation.skip_overwrite_newer_mongoose", { signalId: doc.signalId });
        continue;
      }

      // Late Fill Recovery: Context is SCHEDULED (waiting for price) but MT5 already has it open
      if (["SCHEDULED", "READY_FOR_EXECUTION"].includes(doc.pipelineStatus)) {
        doc.pipelineStatus = "EXECUTED";
        doc.order.executionStatus = "EXECUTED";
        doc.order.ticket = ticket;
        doc.order.fillPrice = Number(pos.openPrice || pos.price);
        doc.order.executedAt = pos.openTime ? new Date(pos.openTime) : now;
        doc.order.executionResult = "SUCCESS";
        doc.monitoring.status = "POSITION_OPEN";
        doc.monitoring.positionOpenedAt = pos.openTime ? new Date(pos.openTime) : now;

        synchronizedContexts.push(doc.signalId);
        updatesBatch.push(doc);
      }
    }

    // 3. Loop through Mongoose contexts to detect offline closed positions
    for (const doc of unresolvedDocs) {
      // Ignore completed and processed contexts
      if (doc.pipelineStatus === "COMPLETED" && doc.rating?.processed === true) {
        continue;
      }

      // If context says trade is running (EXECUTED / POSITION_OPEN) but ticket is missing from MT5 active positions:
      if (doc.pipelineStatus === "EXECUTED" && doc.monitoring?.status === "POSITION_OPEN") {
        const ticket = doc.order?.ticket;
        if (ticket && !activeTickets.has(ticket)) {
          // Closed offline recovery: Look in MT5 history
          const hist = closedHistoryList.find(h => String(h.ticket) === ticket);
          if (hist) {
            doc.monitoring.status = "POSITION_CLOSED";
            doc.monitoring.positionClosedAt = hist.exitTime ? new Date(hist.exitTime) : now;
            doc.monitoring.closeReason = hist.reason || "UNKNOWN";
            doc.monitoring.lastKnownPrice = Number(hist.exitPrice || hist.price);
          } else {
            doc.monitoring.status = "POSITION_CLOSED";
            doc.monitoring.positionClosedAt = now;
            doc.monitoring.closeReason = "UNKNOWN";
          }

          recoveredContexts.push(doc.signalId);
          updatesBatch.push(doc);
        }
      }
    }

    // 4. Apply Mongoose updates sequentially
    for (const doc of updatesBatch) {
      try {
        await doc.save();
        // If recovered closed trade, emit ORDER_CLOSED tradeEvent to let worker run Stage 7 & 8
        if (doc.monitoring?.status === "POSITION_CLOSED") {
          mt5Events.emit("tradeEvent", {
            eventType: "ORDER_CLOSED",
            payload: {
              recommendationId: doc.signalId,
              ticket: doc.order.ticket,
              exitPrice: doc.monitoring.lastKnownPrice || doc.entry,
              exitTime: doc.monitoring.positionClosedAt,
              reason: doc.monitoring.closeReason
            }
          });
        }
      } catch (err) {
        failures.push({ signalId: doc.signalId, error: err.message });
      }
    }

    // 5. Write Quarantined Orphans
    for (const orphan of orphanTrades) {
      try {
        await QuarantinedOrphan.create(orphan);
      } catch (err) {
        logger.error("reconciliation.quarantine_failed", { ticket: orphan.ticket, error: err.message });
      }
    }

    // 6. Write Reconciliation Log
    const report = {
      reconciliationId,
      timestamp: now,
      recoveredContexts,
      orphanTrades,
      synchronizedContexts,
      failures
    };
    await ValidationReconciliationLog.create(report);

    logger.info("reconciliation.completed", {
      reconciliationId,
      recoveredCount: recoveredContexts.length,
      synchronizedCount: synchronizedContexts.length,
      orphansCount: orphanTrades.length,
      failuresCount: failures.length
    });

    return report;

  } catch (err) {
    logger.error("reconciliation.process_fatal_error", { reconciliationId, error: err.message });
    return {
      reconciliationId,
      timestamp: now,
      recoveredContexts: [],
      orphanTrades: [],
      synchronizedContexts: [],
      failures: [{ signalId: 0, error: err.message }]
    };
  }
}
