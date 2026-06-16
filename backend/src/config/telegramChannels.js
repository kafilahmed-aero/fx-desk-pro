// Add or remove monitored Telegram channels here.
// Runtime credentials and polling intervals still live in environment variables.
export const monitoredTelegramChannels = [
  {
    ref: "FXTradingVision",
    username: "FXTradingVision",
    title: "FXTradingVision",
  },
  {
    ref: "UNITED_KINGS_SIGNALSl",
    username: "UNITED_KINGS_SIGNALSl",
    title: "UNITED KINGS SIGNALS",
  },
  {
    ref: "ForexGoldXauusdscalpingSignals",
    username: "ForexGoldXauusdscalpingSignals",
    title: "Forex Gold XAUUSD Scalping Signals",
  },
  {
    ref: "anabelsignals",
    username: "anabelsignals",
    title: "AnabelSignals",
  },
  {
    ref: "AltSignals_Gold_Fx_Signals",
    username: "AltSignals_Gold_Fx_Signals",
    title: "AltSignals Gold FX Signals",
  },
  {
    ref: "forexgdp_forex_gdp",
    username: "forexgdp_forex_gdp",
    title: "Forex GDP",
  },
  {
    ref: "ForexSignalsFactoryltd",
    username: "ForexSignalsFactoryltd",
    title: "Forex Signals Factory",
  },
  {
    ref: "https://t.me/+Mau70cXi4N1kYWM9",
    username: null,
    title: "Private Telegram invite channel",
  },
  {
    ref: "tradewithpatfree",
    username: "tradewithpatfree",
    title: "Trade with Pat 🆓 (FRN)",
  },
  {
    ref: "UnitedSignalsFX",
    username: "UnitedSignalsFX",
    title: "UnitedSignalsFX",
  },
  {
    ref: "prosignalsfxx",
    username: "prosignalsfxx",
    title: "prosignalsfxx",
  },
  {
    ref: "elitetrading_signals",
    username: "elitetrading_signals",
    title: "elitetrading_signals",
  },
  {
    ref: "gold_forex_signals_vip",
    username: "gold_forex_signals_vip",
    title: "gold_forex_signals_vip",
  },
  {
    ref: "top_tradingsignals",
    username: "top_tradingsignals",
    title: "top_tradingsignals",
  },
  {
    ref: "forexsignalstrialgroup",
    username: "forexsignalstrialgroup",
    title: "forexsignalstrialgroup",
  },
  {
    ref: "BrianTradingForex",
    username: "BrianTradingForex",
    title: "BrianTradingForex",
  },
  {
    ref: "GOLD_PRO_TRADE0001",
    username: "GOLD_PRO_TRADE0001",
    title: "GOLD PRO TRADE0001",
  },
  {
    ref: "Forex_Trades_MyBillion",
    username: "Forex_Trades_MyBillion",
    title: "Forex Trades MyBillion",
  },
  {
    ref: "GoldTradePrecision1",
    username: "GoldTradePrecision1",
    title: "GoldTradePrecision1",
  },
  {
    ref: "PathanForexTrader1",
    username: "PathanForexTrader1",
    title: "Pathan Forex Trader",
  },
  {
    ref: "Micheal_Tradingpro",
    username: "Micheal_Tradingpro",
    title: "Michael Fx Trader",
  },
  {
    ref: "raza_jaan_1778",
    username: "raza_jaan_1778",
    title: "raza_jaan_1778",
  },
  {
    ref: "Tradewithsaqi1",
    username: "Tradewithsaqi1",
    title: "Tradewithsaqi1",
  },
  {
    ref: "tradewith_Falakfx",
    username: "tradewith_Falakfx",
    title: "tradewith_Falakfx",
  },
  {
    ref: "withtradeLzbzjxudhd12",
    username: "withtradeLzbzjxudhd12",
    title: "withtradeLzbzjxudhd12",
  },
  {
    ref: "TURBOtradersInternationals",
    username: "TURBOtradersInternationals",
    title: "TURBOtradersInternationals",
  },
  {
    ref: "bengoldtrader",
    username: "bengoldtrader",
    title: "bengoldtrader",
  },
  {
    ref: "goldsnipers11",
    username: "goldsnipers11",
    title: "goldsnipers11",
  },
  {
    ref: "mmsignalsfx",
    username: "mmsignalsfx",
    title: "mmsignalsfx",
  },
  {
    ref: "jamesgoldmaster",
    username: "jamesgoldmaster",
    title: "jamesgoldmaster",
  },
  {
    ref: "vincentgoldtrader",
    username: "vincentgoldtrader",
    title: "vincentgoldtrader",
  },
  {
    ref: "AceofGold",
    username: "AceofGold",
    title: "AceofGold",
  },
  {
    ref: "EARNGOLDTRADING1000",
    username: "EARNGOLDTRADING1000",
    title: "EARNGOLDTRADING1000",
  },
  {
    ref: "fabioforex",
    username: "fabioforex",
    title: "fabioforex",
  },
  {
    ref: "arixanderxx7",
    username: "arixanderxx7",
    title: "arixanderxx7",
  },
  {
    ref: "CPabloScalper",
    username: "CPabloScalper",
    title: "CPabloScalper",
  },
  {
    ref: "Day_TradingAcademy",
    username: "Day_TradingAcademy",
    title: "Day_TradingAcademy",
  },
  {
    ref: "gtmo",
    username: "gtmo",
    title: "gtmo",
  },
  {
    ref: "thepaulxyz",
    username: "thepaulxyz",
    title: "thepaulxyz",
  },
  {
    ref: "mygoaldigger7",
    username: "mygoaldigger7",
    title: "mygoaldigger7",
  },
  {
    ref: "livetradeann",
    username: "livetradeann",
    title: "livetradeann",
  },
  {
    ref: "thelimitlessfx",
    username: "thelimitlessfx",
    title: "thelimitlessfx",
  },
];

validateMonitoredTelegramChannels(monitoredTelegramChannels);

export function getMonitoredTelegramChannelRefs() {
  return dedupeChannelRefs(monitoredTelegramChannels.map((channel) => channel.ref));
}

function validateMonitoredTelegramChannels(channels) {
  if (!Array.isArray(channels)) {
    throw new Error("monitoredTelegramChannels must be an array.");
  }

  const seenRefs = new Set();

  for (const channel of channels) {
    const ref = String(channel?.ref || "").trim();

    if (!ref) {
      throw new Error("Every monitored Telegram channel needs a non-empty ref.");
    }

    if (seenRefs.has(ref)) {
      throw new Error(`Duplicate monitored Telegram channel ref: ${ref}`);
    }

    seenRefs.add(ref);
  }
}

function dedupeChannelRefs(channelRefs) {
  return [
    ...new Set(
      channelRefs
        .map((channelRef) => String(channelRef || "").trim())
        .filter(Boolean)
    ),
  ];
}
