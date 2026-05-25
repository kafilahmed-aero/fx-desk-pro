// Supported trading symbols are centralized so parser coverage can grow safely.
export const supportedPairs = [
  {
    canonical: "XAUUSD",
    aliases: ["XAUUSD", "XAU/USD", "GOLD", "XAU"],
  },
  {
    canonical: "EURUSD",
    aliases: ["EURUSD", "EUR/USD"],
  },
  {
    canonical: "GBPUSD",
    aliases: ["GBPUSD", "GBP/USD"],
  },
  {
    canonical: "USDJPY",
    aliases: ["USDJPY", "USD/JPY"],
  },
  {
    canonical: "AUDJPY",
    aliases: ["AUDJPY", "AUD/JPY"],
  },
  {
    canonical: "BTCUSD",
    aliases: ["BTCUSD", "BTC/USD", "BTC", "BITCOIN"],
  },
  {
    canonical: "US30",
    aliases: ["US30", "DOW", "DOW JONES"],
  },
  {
    canonical: "NAS100",
    aliases: ["NAS100", "NASDAQ", "USTEC"],
  },
];
