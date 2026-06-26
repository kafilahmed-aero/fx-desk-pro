import {
  forexPairs,
  recentSignals,
  signalChartData,
  strengthChartData,
} from "../data/signals";
import {
  createCredentialedEventSource,
  fetchWithCredentials,
} from "./apiClient";

const API_DELAY = 900;
const smartAlertDebugPrefix = "[SMART_ALERT_DEBUG]";

const simulateRequest = (data, delay = API_DELAY) =>
  new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(data);
    }, delay);
  });

export const getForexPairs = () => simulateRequest(forexPairs);

export const getRecentSignals = () => simulateRequest(recentSignals);

export const getChartData = () =>
  simulateRequest({
    signalChartData,
    strengthChartData,
  });

async function fetchJson(path, errorLabel, options = {}) {
  const response = await fetchWithCredentials(path, {
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`${errorLabel}: ${response.status}`);
  }

  return response.json();
}

export async function getParsedSignals(options = {}) {
  const signals = await fetchJson(
    "/signals",
    "Failed to load parsed signals",
    options
  );
  return signals || [];
}

export async function getActiveOpportunities(options = {}) {
  const payload = await fetchJson(
    "/consensus/opportunities",
    "Failed to load active opportunities",
    options
  );

  return payload.opportunities || [];
}

export async function getActivePairStates(options = {}) {
  const payload = await fetchJson(
    "/consensus/active-pairs",
    "Failed to load active pair states",
    options
  );

  return payload.pairs || [];
}

export async function getWeightedConsensus(options = {}) {
  const payload = await fetchJson(
    "/consensus/weighted-consensus",
    "Failed to load weighted consensus",
    options
  );

  return payload.pairs || [];
}

export async function getLiveMarketOverview(options = {}) {
  const payload = await fetchJson(
    "/consensus/overview",
    "Failed to load live market overview",
    options
  );

  return payload.overview || null;
}

export function subscribeToConsensusEvents(onMessage, onError, onNewSignal) {
  console.info(`${smartAlertDebugPrefix} SSE subscription initializing`, {
    path: "/consensus/events",
    smartAlertEventName: "smart-alert",
  });

  const events = createCredentialedEventSource("/consensus/events");

  events.onopen = () => {
    console.info(`${smartAlertDebugPrefix} SSE connection opened`, {
      path: "/consensus/events",
      readyState: events.readyState,
    });
  };

  events.addEventListener("connected", (event) => {
    const payload = parseSsePayload(event, "connected");
    if (payload === null) return;
    console.info(`${smartAlertDebugPrefix} incoming SSE payload`, {
      eventName: "connected",
      payload,
    });
  });

  events.addEventListener("heartbeat", (event) => {
    const payload = parseSsePayload(event, "heartbeat");
    if (payload === null) return;
    console.info(`${smartAlertDebugPrefix} incoming SSE payload`, {
      eventName: "heartbeat",
      payload,
    });
  });

  events.addEventListener("pair-state-updated", (event) => {
    const payload = parseSsePayload(event, "pair-state-updated");
    if (payload === null) return;
    console.log("[SSE EVENT]", event.type, payload);
    console.info(`${smartAlertDebugPrefix} incoming SSE payload`, {
      eventName: "pair-state-updated",
      payload,
    });
    onMessage?.(payload);
  });

  events.addEventListener("new-signal-alert", (event) => {
    const payload = parseSsePayload(event, "new-signal-alert");
    if (payload === null) return;
    console.info(`${smartAlertDebugPrefix} incoming SSE payload`, {
      eventName: "new-signal-alert",
      payload,
    });
    onNewSignal?.(payload);
  });

  events.onerror = (event) => {
    console.warn(`${smartAlertDebugPrefix} SSE connection error`, {
      reason: "SSE stream error or reconnect",
      readyState: events.readyState,
      event,
    });
    onError?.(event);
  };

  return () => {
    console.info(`${smartAlertDebugPrefix} SSE connection closing`, {
      path: "/consensus/events",
      readyState: events.readyState,
    });
    events.close();
    console.info(`${smartAlertDebugPrefix} SSE connection closed`, {
      path: "/consensus/events",
      readyState: events.readyState,
    });
  };
}

function parseSsePayload(event, eventName) {
  console.info(`${smartAlertDebugPrefix} raw SSE payload received`, {
    eventName,
    data: event.data,
  });

  try {
    return JSON.parse(event.data);
  } catch (error) {
    console.warn(`${smartAlertDebugPrefix} SSE payload parse failed`, {
      eventName,
      data: event.data,
      error: error.message,
    });
    return null;
  }
}
