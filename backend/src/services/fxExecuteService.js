import { logger } from "../utils/logger.js";

// In-memory dispatch tracking set to guarantee single-dispatch per signal
const dispatchedSignalsCache = new Set();

export function isSignalDispatched(signal) {
  const key = signal?._id ? String(signal._id) : `${signal?.channel || signal?.channelId}:${signal?.messageId || signal?.telegramMessageId}`;
  return dispatchedSignalsCache.has(key);
}

export function markSignalDispatched(signal) {
  const key = signal?._id ? String(signal._id) : `${signal?.channel || signal?.channelId}:${signal?.messageId || signal?.telegramMessageId}`;
  dispatchedSignalsCache.add(key);
}

/**
 * Dedicated FX Execute Integration Service
 * Responsibility: Transmit parsed NEW_SIGNAL payloads to FX Execute's REST API endpoint.
 * Independent of DB insertion, transparent logging, single-dispatch enforced.
 */
export async function sendSignalToFxExecute(signal) {
  const timestamp = new Date().toISOString();
  const signalKey = signal?._id ? String(signal._id) : `${signal?.channel || signal?.channelId}:${signal?.messageId || signal?.telegramMessageId}`;

  console.log(`\n======================================================`);
  console.log(`[DISPATCH AUDIT] Signal parsed: ID ${signalKey} | Pair: ${signal?.pair} | Classification: ${signal?.classification}`);
  console.log(`[DISPATCH AUDIT] Dispatch decision: Evaluating eligibility for FX Execute...`);

  // 1. Signal Filter: Send ONLY NEW_SIGNAL
  if (signal?.classification !== "NEW_SIGNAL") {
    console.log(`[DISPATCH AUDIT] Classification is not NEW_SIGNAL (${signal?.classification}). Skipping dispatch.`);
    return;
  }

  // 2. Already Dispatched Check
  if (dispatchedSignalsCache.has(signalKey)) {
    console.log(`[DISPATCH AUDIT] Already dispatched?: YES. Signal ${signalKey} has already been dispatched. Skipping HTTP POST.`);
    return;
  }
  console.log(`[DISPATCH AUDIT] Already dispatched?: NO.`);

  try {
    // 3. Payload Validation: Verify required fields before dispatch
    const pair = signal?.pair;
    const action = signal?.action || signal?.direction;
    const stopLoss = signal?.stopLoss;
    const entryMin = Array.isArray(signal?.entryRange) && signal.entryRange.length > 0
      ? signal.entryRange[0]
      : signal?.entry;
    const entryMax = Array.isArray(signal?.entryRange) && signal.entryRange.length > 1
      ? signal.entryRange[1]
      : (entryMin || signal?.entry);
    const tp1 = signal?.targets?.[0] ?? signal?.pipTargets?.[0] ?? signal?.target ?? (entryMin ? (action === "BUY" ? entryMin * 1.005 : entryMin * 0.995) : undefined);

    if (!pair || pair === "unknown" || !action || stopLoss === null || stopLoss === undefined || entryMin === null || entryMin === undefined) {
      console.log(`[DISPATCH AUDIT] Validation FAIL: Missing required trading fields in signal payload.`);
      console.log(`Details -> Pair: ${pair}, Action: ${action}, EntryMin: ${entryMin}, SL: ${stopLoss}`);
      logger.warn("fx_execute.signal_skipped_incomplete", {
        signalId: signalKey,
        pair,
        reason: "Missing required trading fields (Pair, Direction, Entry, or SL)"
      });
      return;
    }

    // Mark as dispatched immediately to prevent race conditions
    dispatchedSignalsCache.add(signalKey);

    // 4. Construct Payload Schema
    const payload = {
      signalId: signalKey,
      telegramMessageId: String(signal.messageId || signal.telegramMessageId || "N/A"),
      channelId: String(signal.channel || signal.channelId || "N/A"),
      pair: String(pair).toUpperCase(),
      direction: String(action).toUpperCase(),
      entryMin: Number(entryMin),
      entryMax: Number(entryMax),
      stopLoss: Number(stopLoss),
      tp1: tp1 !== undefined ? Number(tp1) : undefined,
      tp2: signal?.targets?.[1] ?? signal?.pipTargets?.[1] ? Number(signal?.targets?.[1] ?? signal?.pipTargets?.[1]) : undefined,
      tp3: signal?.targets?.[2] ?? signal?.pipTargets?.[2] ? Number(signal?.targets?.[2] ?? signal?.pipTargets?.[2]) : undefined,
      createdAt: signal.createdAt || timestamp
    };

    // 5. Resolve Target Endpoint URL
    const baseUrl = (process.env.FX_EXECUTE_API_URL || "http://localhost:5005").replace(/\/$/, "");
    const endpoint = `${baseUrl}/api/v1/signals/ingest`;

    console.log(`[DISPATCH AUDIT] HTTP POST started -> Destination: ${endpoint}`);
    console.log(`Payload JSON:\n${JSON.stringify(payload, null, 2)}`);

    const startTime = Date.now();

    // 6. Asynchronous HTTP POST Dispatch
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const latency = Date.now() - startTime;
    const resText = await res.text();
    let data = {};
    try { data = JSON.parse(resText); } catch (e) { data = { rawText: resText }; }

    console.log(`[DISPATCH AUDIT] HTTP POST completed -> Status Code: ${res.status} ${res.statusText} (${latency}ms)`);
    console.log(`Response Body:\n${resText}`);
    console.log(`[DISPATCH AUDIT] Dispatch status updated -> Dispatched: true for Signal ${signalKey}`);
    console.log(`======================================================\n`);

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
    console.log(`[DISPATCH AUDIT EXCEPTION] HTTP POST threw error: ${err.message}`);
    logger.error("fx_execute.network_error", {
      signalId: signalKey,
      pair: signal?.pair,
      error: err.message,
      timestamp
    });
  }
}
