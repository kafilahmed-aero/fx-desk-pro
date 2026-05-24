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
