import {
  forexPairs,
  recentSignals,
  signalChartData,
  strengthChartData,
} from "../data/signals";
import { frontendConfig } from "../config/env";

const API_DELAY = 900;

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

const API_BASE_URL = frontendConfig.apiBaseUrl;
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

async function fetchJson(path, errorLabel, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
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
  const events = new EventSource(`${API_ORIGIN}/api/consensus/events`, {
    withCredentials: true,
  });

  events.addEventListener("pair-state-updated", (event) => {
    onMessage?.(JSON.parse(event.data));
  });

  events.onerror = (event) => {
    onError?.(event);
  };

  return () => {
    events.close();
  };
}
