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

export function subscribeToConsensusEvents(onMessage, onError) {
  const events = createCredentialedEventSource("/consensus/events");

  events.onopen = () => {
    console.info(`${smartAlertDebugPrefix} SSE connection opened`, {
      path: "/consensus/events",
      readyState: events.readyState,
    });
  };

  events.addEventListener("pair-state-updated", (event) => {
    onMessage?.(JSON.parse(event.data));
  });

  events.addEventListener("smart-alert", (event) => {
    const payload = JSON.parse(event.data);
    console.info(`${smartAlertDebugPrefix} incoming smart-alert event received`, {
      pair: payload?.pair,
      alertType: payload?.type,
      confidence: payload?.confidence,
      payload,
    });
    onMessage?.(payload);
  });

  events.onerror = (event) => {
    console.warn(`${smartAlertDebugPrefix} alert filtered/skipped reason`, {
      reason: "SSE stream error or reconnect",
      readyState: events.readyState,
    });
    onError?.(event);
  };

  return () => {
    events.close();
  };
}
