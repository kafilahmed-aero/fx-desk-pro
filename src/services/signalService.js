import {
  forexPairs,
  recentSignals,
  signalChartData,
  strengthChartData,
} from "../data/signals";

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

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

export async function getActiveOpportunities() {
  const response = await fetch(`${API_BASE_URL}/consensus/opportunities`);

  if (!response.ok) {
    throw new Error(`Failed to load active opportunities: ${response.status}`);
  }

  const payload = await response.json();
  return payload.opportunities || [];
}

export async function getActivePairStates() {
  const response = await fetch(`${API_BASE_URL}/consensus/active-pairs`);

  if (!response.ok) {
    throw new Error(`Failed to load active pair states: ${response.status}`);
  }

  const payload = await response.json();
  return payload.pairs || [];
}
