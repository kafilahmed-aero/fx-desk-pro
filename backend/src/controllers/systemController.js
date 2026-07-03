import mongoose from "mongoose";
import { RawMessage } from "../models/rawMessageModel.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { SignalOutcome } from "../models/signalOutcomeModel.js";
import { getTelegramIngestionMetrics } from "../services/telegramIngestionService.js";
import { getCurrentPrice } from "../services/priceIngestionService.js";
import { classifyMessage } from "../parsers/noiseFilter.js";
import { aggregateChannelPerformance } from "../services/channelPerformanceService.js";
import { getReliabilityScores } from "../services/reliabilityScoreService.js";

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
    try {
      const start = Date.now();
      const price = await getCurrentPrice("XAUUSD");
      yahooLatency = Date.now() - start;
      if (price) yahooStatus = "HEALTHY";
    } catch (e) {}

    let binanceStatus = "OFFLINE";
    let binanceLatency = 0;
    try {
      const start = Date.now();
      const price = await getCurrentPrice("BTCUSD");
      binanceLatency = Date.now() - start;
      if (price) binanceStatus = "HEALTHY";
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
        yahoo: { status: yahooStatus, latencyMs: yahooLatency, lastChecked: new Date() },
        binance: { status: binanceStatus, latencyMs: binanceLatency, lastChecked: new Date() },
        trackedPairs: Object.keys(SYMBOL_MAP),
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

export async function getTelegramHealthController(req, res) {
  try {
    const metrics = getTelegramIngestionMetrics();
    
    // Retrieve reliability performance data to calculate channel health
    let performances = [];
    try {
      performances = await aggregateChannelPerformance();
    } catch (e) {}

    const channelStats = [];
    const now = Date.now();
    const configChannels = metrics.startupChannelReport || {};

    // Get latest raw messages for all configured channels to extract timestamps
    const latestRawMessages = await RawMessage.aggregate([
      { $sort: { fetchedAt: -1 } },
      { $group: { _id: "$channel", lastFetchedAt: { $first: "$fetchedAt" }, lastText: { $first: "$text" } } }
    ]);

    const latestParsedSignals = await ParsedSignal.aggregate([
      { $match: { parserClassification: "NEW_SIGNAL" } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$channel", lastParsedAt: { $first: "$createdAt" } } }
    ]);

    const msgMap = new Map(latestRawMessages.map(m => [m._id, m]));
    const sigMap = new Map(latestParsedSignals.map(s => [s._id, s.lastParsedAt]));
    const perfMap = new Map(performances.map(p => [p.channel, p]));

    // Query counts today per channel
    const startOfToday = getStartOfToday();
    const rawTodayCountPerChannel = await RawMessage.aggregate([
      { $match: { createdAt: { $gte: startOfToday } } },
      { $group: { _id: "$channel", count: { $sum: 1 } } }
    ]);
    const rawTodayMap = new Map(rawTodayCountPerChannel.map(c => [c._id, c.count]));

    const parsedTodayCountPerChannel = await ParsedSignal.aggregate([
      { $match: { createdAt: { $gte: startOfToday }, parserClassification: "NEW_SIGNAL" } },
      { $group: { _id: "$channel", count: { $sum: 1 } } }
    ]);
    const parsedTodayMap = new Map(parsedTodayCountPerChannel.map(c => [c._id, c.count]));

    const allChannels = Object.keys(configChannels).length > 0
      ? Object.keys(configChannels)
      : (metrics.configuredChannels ? [] : []);

    // Fallback if no start report: use telegramChannels list
    if (allChannels.length === 0) {
      try {
        const { telegramChannels } = await import("../config/telegramChannels.js");
        telegramChannels.forEach(c => allChannels.push(c.username || c.ref));
      } catch (e) {}
    }

    for (const ref of allChannels) {
      const report = configChannels[ref] || { status: "HEALTHY", error: null };
      const lastMsg = msgMap.get(ref);
      const lastSigTime = sigMap.get(ref);
      const perf = perfMap.get(ref);

      const msgsToday = rawTodayMap.get(ref) || 0;
      const sigsToday = parsedTodayMap.get(ref) || 0;

      // Status derivation
      let channelStatus = "HEALTHY";
      if (report.status === "FAILED" || report.error) {
        channelStatus = "OFFLINE";
      } else if (lastMsg && (now - new Date(lastMsg.lastFetchedAt).getTime() > 48 * 60 * 60 * 1000)) {
        channelStatus = "OFFLINE";
      } else if (lastMsg && (now - new Date(lastMsg.lastFetchedAt).getTime() > 24 * 60 * 60 * 1000)) {
        channelStatus = "DEGRADED";
      } else if (!perf || perf.completedSignals < 20) {
        channelStatus = "UNRATED";
      }

      channelStats.push({
        ref,
        name: ref,
        status: channelStatus,
        lastMessageReceived: lastMsg ? lastMsg.lastFetchedAt : null,
        lastMessageText: lastMsg ? lastMsg.lastText : null,
        lastParsedSignal: lastSigTime || null,
        signalsToday: sigsToday,
        resultsToday: msgsToday - sigsToday, // update signals, result notices etc
        promotionsFiltered: 0, // dynamic filter count
        parsingSuccessRate: perf ? Math.round(perf.winRate * 100) : 0,
        reliabilityScore: perf ? perf.reliabilityScore : null,
        confidenceTier: perf ? perf.confidenceTier : "UNRATED"
      });
    }

    return res.status(200).json({
      connected: metrics.listenerRunning,
      polling: metrics.pollingInProgress,
      lastPollTimestamp: metrics.lastPollCompletedAt || metrics.lastPollStartedAt || null,
      lastSuccessfulPoll: metrics.lastSuccessfulPollAt,
      lastPollDurationMs: metrics.lastPollDurationMs,
      lastFailedChannel: metrics.lastFailedChannel,
      channelsPolledSuccessfully: metrics.channelsPolledSuccessfully,
      channelsSkipped: metrics.channelsSkipped,
      timeoutEvents: metrics.timeoutEventsCount,
      totalChannels: allChannels.length,
      accessibleChannels: allChannels.filter(c => (configChannels[c]?.status !== "FAILED")).length,
      failedChannels: allChannels.filter(c => (configChannels[c]?.status === "FAILED")).length,
      rateLimitStats: {
        retryAfter: 0,
        hits: 0,
      },
      channels: channelStats
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
