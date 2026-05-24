export const forexPairs = [
  { name: "GOLD", signal: "82% BUY", color: "green", percentage: 82 },
  { name: "EURUSD", signal: "61% SELL", color: "red", percentage: 61 },
  { name: "GBPUSD", signal: "55% BUY", color: "green", percentage: 55 },
  { name: "USDJPY", signal: "73% SELL", color: "red", percentage: 73 },
];

export const recentSignals = [
  {
    pair: "GOLD",
    signal: "BUY",
    confidence: 82,
    entry: "2368.40",
    target: "2395.00",
    time: "09:45 AM",
    color: "green",
    status: "Active",
  },
  {
    pair: "EURUSD",
    signal: "SELL",
    confidence: 61,
    entry: "1.0842",
    target: "1.0785",
    time: "09:18 AM",
    color: "red",
    status: "Expired",
  },
  {
    pair: "GBPUSD",
    signal: "BUY",
    confidence: 55,
    entry: "1.2690",
    target: "1.2765",
    time: "08:52 AM",
    color: "green",
    status: "Active",
  },
  {
    pair: "USDJPY",
    signal: "SELL",
    confidence: 73,
    entry: "156.84",
    target: "155.90",
    time: "08:21 AM",
    color: "red",
    status: "Hit Target",
  },
];

export const signalChartData = [
  { name: "Buy", value: 2, color: "#4ADE80" },
  { name: "Sell", value: 2, color: "#F87171" },
];

export const strengthChartData = [
  { name: "GOLD", strength: 82, color: "#4ADE80" },
  { name: "EURUSD", strength: 61, color: "#F87171" },
  { name: "GBPUSD", strength: 55, color: "#4ADE80" },
  { name: "USDJPY", strength: 73, color: "#F87171" },
];
