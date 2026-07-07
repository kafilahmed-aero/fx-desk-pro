import mongoose from "mongoose";
import { RawMessage } from "../models/rawMessageModel.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { SignalOutcome } from "../models/signalOutcomeModel.js";
import { getTelegramIngestionMetrics } from "../services/telegramIngestionService.js";
import { getCurrentPrice } from "../services/priceIngestionService.js";
import { classifyMessage } from "../parsers/noiseFilter.js";
import { isAiTradingSessionActive } from "../services/tradingSessionService.js";
import { config } from "../config/env.js";

const SYMBOL_MAP = {
  "XAUUSD": "GC=F",
  "EURUSD": "EURUSD=X",
  "GBPJPY": "GBPJPY=X",
  "BTCUSD": "BTCUSDT"
};

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getSystemHealthController(req, res) {
  try {
    const mongoStatus = mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED";
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    // Check Price Feeds
    let yahooStatus = "OFFLINE";
    let yahooLatency = 0;
    let yahooSource = "YAHOO";
    let xauusdPrice = null;
    try {
      const start = Date.now();
      const price = await getCurrentPrice("XAUUSD");
      yahooLatency = Date.now() - start;
      if (price) {
        yahooStatus = "HEALTHY";
        yahooSource = price.source || "YAHOO";
        xauusdPrice = price.price;
      }
    } catch (e) {}

    let binanceStatus = "OFFLINE";
    let binanceLatency = 0;
    let binanceSource = "BINANCE";
    let btcusdPrice = null;
    try {
      const start = Date.now();
      const price = await getCurrentPrice("BTCUSD");
      binanceLatency = Date.now() - start;
      if (price) {
        binanceStatus = "HEALTHY";
        binanceSource = price.source || "BINANCE";
        btcusdPrice = price.price;
      }
    } catch (e) {}

    const telegramMetrics = getTelegramIngestionMetrics();

    return res.status(200).json({
      status: "HEALTHY",
      uptime,
      memory: {
        rss: Math.round(memory.rss / (1024 * 1024)) + " MB",
        heapTotal: Math.round(memory.heapTotal / (1024 * 1024)) + " MB",
        heapUsed: Math.round(memory.heapUsed / (1024 * 1024)) + " MB",
      },
      database: {
        status: mongoStatus,
        provider: "MongoDB Atlas",
      },
      telegram: {
        status: telegramMetrics.listenerRunning ? "CONNECTED" : "DISCONNECTED",
        polling: telegramMetrics.pollingInProgress ? "ACTIVE" : "INACTIVE",
        lastSuccessfulPoll: telegramMetrics.lastSuccessfulPollAt,
        lastPollDurationMs: telegramMetrics.lastPollDurationMs,
        lastFailedChannel: telegramMetrics.lastFailedChannel,
        channelsPolledSuccessfully: telegramMetrics.channelsPolledSuccessfully,
        channelsSkipped: telegramMetrics.channelsSkipped,
        timeoutEvents: telegramMetrics.timeoutEventsCount,
      },
      priceFeeds: {
        yahoo: { status: yahooStatus, latencyMs: yahooLatency, source: yahooSource, lastChecked: new Date() },
        binance: { status: binanceStatus, latencyMs: binanceLatency, source: binanceSource, lastChecked: new Date() },
        xauusdPrice,
        btcusdPrice,
        trackedPairs: Object.keys(SYMBOL_MAP),
      },
      tradingSession: {
        active: isAiTradingSessionActive(),
        start: config.aiSessionStartIst,
        end: config.aiSessionEndIst,
      },
      activeServices: {
        telegramListener: telegramMetrics.listenerRunning,
        keepAliveService: true,
        priceIngestionScheduler: true,
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}


export async function getParserHealthController(req, res) {
  try {
    const startOfToday = getStartOfToday();

    // Successfully parsed today
    const parsedTodayCount = await ParsedSignal.countDocuments({
      createdAt: { $gte: startOfToday },
      parserClassification: "NEW_SIGNAL"
    });

    const totalRawToday = await RawMessage.countDocuments({
      createdAt: { $gte: startOfToday }
    });

    const successPercentage = totalRawToday > 0 ? Math.round((parsedTodayCount / totalRawToday) * 100) : 100;

    // Fetch unparsed candidate messages (which contain Buy/Sell but were classified as Noise/Promo)
    const rawMessagesToday = await RawMessage.find({
      createdAt: { $gte: startOfToday },
      text: { $regex: /\b(BUY|SELL|ENTRY|TP|SL|TARGET|GOLD|XAUUSD)\b/i }
    }).sort({ fetchedAt: -1 }).limit(20).lean();

    const matchedSignals = await ParsedSignal.find({
      createdAt: { $gte: startOfToday },
      parserClassification: "NEW_SIGNAL"
    }).select("channel messageId").lean();

    const parsedKeys = new Set(matchedSignals.map(s => `${s.channel}:${s.messageId}`));
    const unparsedCandidates = [];

    for (const msg of rawMessagesToday) {
      const key = `${msg.channel}:${msg.messageId}`;
      if (!parsedKeys.has(key)) {
        const cls = classifyMessage(msg);
        unparsedCandidates.push({
          rawText: msg.text,
          channel: msg.channel,
          timestamp: msg.fetchedAt,
          failureReason: cls.classification === "PROMO" ? "Promotional content detected" : "Failed mandatory parameters validation"
        });
      }
    }

    // Suspicious signals: Active or Partial containing entries/SL/targets <= 10
    const suspiciousSignals = await ParsedSignal.find({
      signalState: { $in: ["ACTIVE", "PARTIAL"] },
      $or: [
        { entry: { $lte: 10 } },
        { stopLoss: { $lte: 10 } },
        { targets: { $elemMatch: { $lte: 10 } } }
      ]
    }).sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      parsedTodayCount,
      successPercentage,
      unparsedCandidates,
      suspiciousSignals: suspiciousSignals.map(s => ({
        id: s._id,
        channel: s.channel,
        pair: s.pair,
        rawText: s.rawText,
        entry: s.entry,
        targets: s.targets,
        stopLoss: s.stopLoss,
        reason: "Invalid single-digit entry, target, or stop loss (< 10)"
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getMetricsController(req, res) {
  try {
    const startOfToday = getStartOfToday();

    const rawTodayCount = await RawMessage.countDocuments({ createdAt: { $gte: startOfToday } });
    const parsedTodayCount = await ParsedSignal.countDocuments({
      createdAt: { $gte: startOfToday },
      parserClassification: "NEW_SIGNAL"
    });

    // Promotions and Results filtered today
    const rawMessagesToday = await RawMessage.find({ createdAt: { $gte: startOfToday } }).lean();
    let promotionsCount = 0;
    let resultsCount = 0;
    for (const msg of rawMessagesToday) {
      const cls = classifyMessage(msg);
      if (cls.classification === "PROMO") promotionsCount++;
      else if (cls.classification === "RESULT_SIGNAL") resultsCount++;
    }

    const activeOpportunitiesCount = await ParsedSignal.countDocuments({
      signalState: { $in: ["ACTIVE", "PARTIAL"] }
    });

    // Trade outcomes today
    const fullTpToday = await SignalOutcome.countDocuments({ status: "FULL_TP", updatedAt: { $gte: startOfToday } });
    const partialTpToday = await SignalOutcome.countDocuments({ status: "PARTIAL_TP", updatedAt: { $gte: startOfToday } });
    const slHitToday = await SignalOutcome.countDocuments({ status: "SL_HIT", updatedAt: { $gte: startOfToday } });
    const expiredToday = await SignalOutcome.countDocuments({ status: "EXPIRED", updatedAt: { $gte: startOfToday } });

    return res.status(200).json({
      dailyMetrics: {
        rawMessagesToday: rawTodayCount,
        signalsParsedToday: parsedTodayCount,
        promotionsFiltered: promotionsCount,
        resultsFiltered: resultsCount,
        activeOpportunities: activeOpportunitiesCount,
        notificationsSent: parsedTodayCount,
      },
      tradeMetrics: {
        fullTpToday,
        partialTpToday,
        slHitToday,
        expiredToday
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getTelegramHealthController(req, res) {
  try {
    const metrics = getTelegramIngestionMetrics();
    return res.status(200).json({
      connected: metrics.listenerRunning,
      polling: metrics.pollingInProgress,
      lastPollTimestamp: metrics.lastPollCompletedAt || metrics.lastPollStartedAt || null,
      lastSuccessfulPoll: metrics.lastSuccessfulPollAt,
      lastPollDurationMs: metrics.lastPollDurationMs,
      channelsPolledSuccessfully: metrics.channelsPolledSuccessfully,
      channelsSkipped: metrics.channelsSkipped,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
