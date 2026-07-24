import { logger } from "../utils/logger.js";

/**
 * Dedicated FX Execute Integration Service
 * Responsibility: Transmit parsed NEW_SIGNAL payloads to FX Execute's REST API endpoint.
 * Non-blocking, transparent logging, strictly scoped.
 */
export async function sendSignalToFxExecute(signal) {
  const timestamp = new Date().toISOString();

  try {
    // 1. Signal Filter: Send ONLY NEW_SIGNAL
    if (signal?.classification !== "NEW_SIGNAL") {
      return;
    }

    // 2. Payload Validation: Verify required fields before dispatch
    const pair = signal?.pair;
    const action = signal?.action || signal?.direction;
    const stopLoss = signal?.stopLoss;
    const entryMin = Array.isArray(signal?.entryRange) && signal.entryRange.length > 0
      ? signal.entryRange[0]
      : signal?.entry;
    const entryMax = Array.isArray(signal?.entryRange) && signal.entryRange.length > 1
      ? signal.entryRange[1]
      : (entryMin || signal?.entry);
    const tp1 = signal?.targets?.[0] ?? signal?.pipTargets?.[0] ?? signal?.target;

    if (!pair || pair === "unknown" || !action || stopLoss === null || stopLoss === undefined || entryMin === null || entryMin === undefined || tp1 === null || tp1 === undefined) {
      logger.warn("fx_execute.signal_skipped_incomplete", {
        signalId: signal?._id || signal?.signalId,
        pair,
        reason: "Missing required trading fields (Pair, Direction, Entry, SL, or TP)"
      });
      return;
    }

    // 3. Construct Minimal Payload Schema
    const payload = {
      signalId: signal._id ? signal._id.toString() : (signal.signalId || `SIG-${Date.now()}`),
      telegramMessageId: String(signal.messageId || signal.telegramMessageId || "N/A"),
      channelId: String(signal.channel || signal.channelId || "N/A"),
      pair: String(pair).toUpperCase(),
      direction: String(action).toUpperCase(),
      entryMin: Number(entryMin),
      entryMax: Number(entryMax),
      stopLoss: Number(stopLoss),
      tp1: Number(tp1),
      tp2: signal?.targets?.[1] ?? signal?.pipTargets?.[1] ? Number(signal?.targets?.[1] ?? signal?.pipTargets?.[1]) : undefined,
      tp3: signal?.targets?.[2] ?? signal?.pipTargets?.[2] ? Number(signal?.targets?.[2] ?? signal?.pipTargets?.[2]) : undefined,
      createdAt: signal.createdAt || timestamp
    };

    // 4. Resolve Target Endpoint URL
    const baseUrl = (process.env.FX_EXECUTE_API_URL || "http://localhost:5005").replace(/\/$/, "");
    const endpoint = `${baseUrl}/api/v1/signals/ingest`;

    // 5. Asynchronous HTTP POST Dispatch
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    // 6. Structured Logging & Response Acknowledgement Check
    if (res.ok && data.success) {
      logger.info("fx_execute.signal_delivered", {
        signalId: payload.signalId,
        pair: payload.pair,
        direction: payload.direction,
        executionId: data.executionId || "N/A",
        ticket: data.ticket || null,
        status: data.status,
        statusCode: res.status,
        timestamp
      });
    } else {
      logger.error("fx_execute.signal_delivery_failed", {
        signalId: payload.signalId,
        pair: payload.pair,
        rejectionReason: data.rejectionReason || data.error || `HTTP ${res.status}`,
        statusCode: res.status,
        timestamp
      });
    }

  } catch (err) {
    logger.error("fx_execute.network_error", {
      signalId: signal?._id || signal?.signalId,
      pair: signal?.pair,
      error: err.message,
      timestamp
    });
  }
}
