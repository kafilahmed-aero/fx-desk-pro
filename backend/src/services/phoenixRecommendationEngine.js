import crypto from "crypto";
import mongoose from "mongoose";
import { generateAnalyticsReport } from "./phoenixAnalyticsEngine.js";
import { PhoenixRecommendation } from "../models/phoenixRecommendationModel.js";
import { phoenixDeepFreeze } from "./phoenixFeatureEngine.js";

// Offline Cache Map for Recommendations
export const localPhoenixRecommendations = new Map();

/**
 * Generates a deterministic unique recommendation ID based on the title, category and timeframe.
 */
export function generateDeterministicId(title, category, timeframe) {
  const hash = crypto.createHash("sha256")
    .update(`${category}:${title}:${timeframe}`)
    .digest("hex")
    .substring(0, 12);
  return `REC-${category.toUpperCase().replace(/\s+/g, "-")}-${hash}`;
}

/**
 * Resolves conflicts when contradictory advice is generated for the same targets.
 * 
 * @param {Array} recs - Array of recommendation payloads
 * @returns {Array} List of resolved recommendations
 */
export function detectAndResolveConflicts(recs) {
  const channelActions = {};
  const strategyActions = {};
  
  recs.forEach(r => {
    if (r.category === "Channels") {
      // Find channel name e.g. "Channel GoldVIP"
      const ch = r.title.match(/Channel\s+(\S+)|weighting\s+for\s+(\S+)/i);
      const channelName = ch ? (ch[1] || ch[2]) : null;
      if (channelName) {
        const action = r.title.includes("Increase") ? "INCREASE" : (r.title.includes("Decrease") || r.title.includes("Remove") ? "DECREASE" : "MONITOR");
        if (!channelActions[channelName]) channelActions[channelName] = [];
        channelActions[channelName].push({ rec: r, action });
      }
    } else if (r.category === "Smart Entry") {
      const strat = r.title.match(/(MARKET|LIMIT|STOP|WAIT)/i)?.[0];
      if (strat) {
        const action = r.title.includes("Preferred") || r.title.includes("Favor") ? "FAVOR" : "AVOID";
        if (!strategyActions[strat]) strategyActions[strat] = [];
        strategyActions[strat].push({ rec: r, action });
      }
    }
  });
  
  const finalRecs = [...recs];
  
  // Resolve channel conflicts
  Object.keys(channelActions).forEach(ch => {
    const list = channelActions[ch];
    const hasIncrease = list.some(item => item.action === "INCREASE");
    const hasDecrease = list.some(item => item.action === "DECREASE");
    if (hasIncrease && hasDecrease) {
      // Remove the conflicting ones
      list.forEach(item => {
        const idx = finalRecs.indexOf(item.rec);
        if (idx > -1) finalRecs.splice(idx, 1);
      });
      
      const title = `Conflict Resolved: Manual Audit Required for Channel ${ch}`;
      const recId = generateDeterministicId(title, "System Health", "allTime");
      
      // Inject unified conflict recommendation
      finalRecs.push({
        recommendationId: recId,
        recommendationVersion: "1.0",
        generatedAt: new Date(),
        analyticsVersion: "1.0",
        status: "ACTIVE",
        category: "System Health",
        title,
        priority: "HIGH",
        confidence: "HIGH",
        impact: "UNKNOWN",
        evidenceSummary: `Conflicting performance metrics computed for Channel ${ch}.`,
        explanation: `Rule conflict resolved: The system generated both positive weighting indicators and risk mitigation warnings for Channel ${ch}. Automated adjustments are suppressed, and a manual review of historical logs is recommended.`,
        supportingStatistics: { channel: ch },
        timeframe: "allTime"
      });
    }
  });

  // Resolve strategy conflicts
  Object.keys(strategyActions).forEach(strat => {
    const list = strategyActions[strat];
    const hasFavor = list.some(item => item.action === "FAVOR");
    const hasAvoid = list.some(item => item.action === "AVOID");
    if (hasFavor && hasAvoid) {
      list.forEach(item => {
        const idx = finalRecs.indexOf(item.rec);
        if (idx > -1) finalRecs.splice(idx, 1);
      });
      
      const title = `Conflict Resolved: Conflicting Smart Entry Strategy Advice for ${strat}`;
      const recId = generateDeterministicId(title, "System Health", "allTime");
      
      finalRecs.push({
        recommendationId: recId,
        recommendationVersion: "1.0",
        generatedAt: new Date(),
        analyticsVersion: "1.0",
        status: "ACTIVE",
        category: "System Health",
        title,
        priority: "HIGH",
        confidence: "HIGH",
        impact: "UNKNOWN",
        evidenceSummary: `Both favor and avoid indicators were triggered for Smart Entry strategy ${strat}.`,
        explanation: `Rule conflict resolved: A conflict occurred where ${strat} met both high profit performance triggers and high maximum drawdown thresholds. Entry weighting remains unaltered pending manual audit.`,
        supportingStatistics: { strategy: strat },
        timeframe: "allTime"
      });
    }
  });
  
  return finalRecs;
}

/**
 * Analyzes historical metrics and generates deterministic improvement recommendations.
 * 
 * @param {Object} filters - Timeframe filters
 * @returns {Promise<Array>} List of recommendations
 */
export async function generateRecommendations(filters = {}) {
  const report = await generateAnalyticsReport(filters);
  const recs = [];
  const timeframe = filters.timeframe || "allTime";

  const totalTrades = report.overall.totalTrades;

  // 1. Insufficient Data Gating
  if (totalTrades < 3) {
    const title = "Collect More Historical Trade Data";
    const recId = generateDeterministicId(title, "System Health", timeframe);
    recs.push({
      recommendationId: recId,
      recommendationVersion: "1.0",
      generatedAt: new Date(),
      analyticsVersion: "1.0",
      status: "ACTIVE",
      category: "System Health",
      title,
      priority: "HIGH",
      confidence: "LOW",
      impact: "HIGH",
      evidenceSummary: `System has recorded only ${totalTrades} completed trades.`,
      explanation: `The Phoenix Recommendation Engine requires a minimum of 3 completed trades to compile statistically valid performance recommendations. Please continue running the system to acquire more trading history.`,
      supportingStatistics: { totalTrades },
      timeframe
    });
    return phoenixDeepFreeze(recs);
  }

  // ==========================================
  // 2. Channels Recommendations
  // ==========================================
  Object.keys(report.channels).forEach(ch => {
    const data = report.channels[ch];
    if (data.tradeCount >= 3) {
      if (data.winRate >= 0.75 && data.averageProfit > 0) {
        const title = `Increase Confidence Weighting for Channel ${ch}`;
        recs.push({
          recommendationId: generateDeterministicId(title, "Channels", timeframe),
          recommendationVersion: "1.0",
          generatedAt: new Date(),
          analyticsVersion: "1.0",
          status: "ACTIVE",
          category: "Channels",
          title,
          priority: "HIGH",
          confidence: data.confidence,
          impact: "HIGH",
          evidenceSummary: `Channel ${ch} win rate: ${(data.winRate * 100).toFixed(1)}%, average profit: ${data.averageProfit} USD, trade count: ${data.tradeCount}.`,
          explanation: `Channel ${ch} is demonstrating high reliability and positive expectancy. Increasing its weighting in the consensus calculation will improve the decision engine score of its signals.`,
          supportingStatistics: { channelName: ch, winRate: data.winRate, avgProfit: data.averageProfit, count: data.tradeCount },
          timeframe
        });
      } else if (data.winRate <= 0.45 && data.averageProfit < 0) {
        const title = `Decrease Confidence Weighting for Channel ${ch}`;
        recs.push({
          recommendationId: generateDeterministicId(title, "Channels", timeframe),
          recommendationVersion: "1.0",
          generatedAt: new Date(),
          analyticsVersion: "1.0",
          status: "ACTIVE",
          category: "Channels",
          title,
          priority: "HIGH",
          confidence: data.confidence,
          impact: "MEDIUM",
          evidenceSummary: `Channel ${ch} win rate: ${(data.winRate * 100).toFixed(1)}%, average profit: ${data.averageProfit} USD, trade count: ${data.tradeCount}.`,
          explanation: `Channel ${ch} is underperforming with a negative historical expectancy. Decreasing its weighting will insulate the decision engine from its high-risk setups.`,
          supportingStatistics: { channelName: ch, winRate: data.winRate, avgProfit: data.averageProfit, count: data.tradeCount },
          timeframe
        });
      } else if (data.winRate < 0.35) {
        const title = `Remove Channel ${ch} Candidate`;
        recs.push({
          recommendationId: generateDeterministicId(title, "Channels", timeframe),
          recommendationVersion: "1.0",
          generatedAt: new Date(),
          analyticsVersion: "1.0",
          status: "ACTIVE",
          category: "Channels",
          title,
          priority: "HIGH",
          confidence: data.confidence,
          impact: "HIGH",
          evidenceSummary: `Channel ${ch} has historically low win rate of ${(data.winRate * 100).toFixed(1)}% across ${data.tradeCount} trades.`,
          explanation: `Due to persistent underperformance below the minimum viability thresholds, it is advised to remove Channel ${ch} from the signal ingestion list.`,
          supportingStatistics: { channelName: ch, winRate: data.winRate, count: data.tradeCount },
          timeframe
        });
      }
    }
  });

  // ==========================================
  // 3. Sessions Recommendations
  // ==========================================
  Object.keys(report.sessions).forEach(s => {
    const data = report.sessions[s];
    if (data.tradeCount >= 3) {
      if (data.winRate >= 0.70 && data.profit > 0) {
        const title = `Preferred Session: Active Engagement in ${s} Session`;
        recs.push({
          recommendationId: generateDeterministicId(title, "Sessions", timeframe),
          recommendationVersion: "1.0",
          generatedAt: new Date(),
          analyticsVersion: "1.0",
          status: "ACTIVE",
          category: "Sessions",
          title,
          priority: "MEDIUM",
          confidence: data.confidence,
          impact: "MEDIUM",
          evidenceSummary: `${s} session win rate is ${(data.winRate * 100).toFixed(1)}%, net profit: ${data.profit} USD.`,
          explanation: `Trading during the ${s} session has yielded strong results. Maintain active operations and capitalize on this session's volume.`,
          supportingStatistics: { session: s, winRate: data.winRate, profit: data.profit, count: data.tradeCount },
          timeframe
        });
      } else if (data.winRate <= 0.45 || data.profit < 0) {
        const title = `Session to Avoid: Reduce Exposure in ${s} Session`;
        recs.push({
          recommendationId: generateDeterministicId(title, "Sessions", timeframe),
          recommendationVersion: "1.0",
          generatedAt: new Date(),
          analyticsVersion: "1.0",
          status: "ACTIVE",
          category: "Sessions",
          title,
          priority: "MEDIUM",
          confidence: data.confidence,
          impact: "MEDIUM",
          evidenceSummary: `${s} session win rate is ${(data.winRate * 100).toFixed(1)}%, net profit: ${data.profit} USD.`,
          explanation: `The ${s} session has demonstrated unfavorable market parameters and negative profits. Reducing exposure or ignoring setups during this session will protect equity.`,
          supportingStatistics: { session: s, winRate: data.winRate, profit: data.profit, count: data.tradeCount },
          timeframe
        });
      }
    }
  });

  // ==========================================
  // 4. Decision Engine Recommendations
  // ==========================================
  Object.keys(report.decisionEngine).forEach(g => {
    const data = report.decisionEngine[g];
    if (data.tradeCount >= 3) {
      if (g === "GRADE C" && (data.winRate <= 0.45 || data.profit < 0)) {
        const title = "Adjust Grade Threshold to Ignore GRADE C Setups";
        recs.push({
          recommendationId: generateDeterministicId(title, "Decision Engine", timeframe),
          recommendationVersion: "1.0",
          generatedAt: new Date(),
          analyticsVersion: "1.0",
          status: "ACTIVE",
          category: "Decision Engine",
          title,
          priority: "MEDIUM",
          confidence: data.confidence,
          impact: "HIGH",
          evidenceSummary: `GRADE C setups have a win rate of ${(data.winRate * 100).toFixed(1)}% and net profit of ${data.profit} USD.`,
          explanation: `GRADE C setups are currently unprofitable. Raising the decision engine execution cutoff to exclude GRADE C recommendations will optimize performance.`,
          supportingStatistics: { grade: g, winRate: data.winRate, profit: data.profit, count: data.tradeCount },
          timeframe
        });
      } else if (g === "GRADE A" && data.winRate >= 0.75) {
        const title = "Increase Leverage Weighting for GRADE A Setups";
        recs.push({
          recommendationId: generateDeterministicId(title, "Decision Engine", timeframe),
          recommendationVersion: "1.0",
          generatedAt: new Date(),
          analyticsVersion: "1.0",
          status: "ACTIVE",
          category: "Decision Engine",
          title,
          priority: "MEDIUM",
          confidence: data.confidence,
          impact: "MEDIUM",
          evidenceSummary: `GRADE A setups have a win rate of ${(data.winRate * 100).toFixed(1)}% across ${data.tradeCount} trades.`,
          explanation: `GRADE A setups demonstrate outstanding reliability. Allocating slightly larger lot sizing parameters or confidence scoring overrides to GRADE A signals will maximize profits.`,
          supportingStatistics: { grade: g, winRate: data.winRate, count: data.tradeCount },
          timeframe
        });
      }
    }
  });

  // ==========================================
  // 5. Smart Entry Recommendations
  // ==========================================
  Object.keys(report.smartEntry).forEach(strat => {
    const data = report.smartEntry[strat];
    if (data.tradeCount >= 3) {
      if (data.winRate >= 0.75) {
        const title = `Preferred Entry Strategy: Favor ${strat} Placements`;
        recs.push({
          recommendationId: generateDeterministicId(title, "Smart Entry", timeframe),
          recommendationVersion: "1.0",
          generatedAt: new Date(),
          analyticsVersion: "1.0",
          status: "ACTIVE",
          category: "Smart Entry",
          title,
          priority: "MEDIUM",
          confidence: data.confidence,
          impact: "MEDIUM",
          evidenceSummary: `${strat} placement strategy win rate is ${(data.winRate * 100).toFixed(1)}% with an average RR of ${data.averageRR}.`,
          explanation: `The ${strat} execution strategy is showing superior trade efficiency and high accuracy. Favor ${strat} orders over direct market fills.`,
          supportingStatistics: { strategy: strat, winRate: data.winRate, averageRR: data.averageRR, count: data.tradeCount },
          timeframe
        });
      } else if (data.winRate <= 0.45 && data.profit < 0) {
        const title = `Review Smart Entry Strategy: Limit ${strat} Usage`;
        recs.push({
          recommendationId: generateDeterministicId(title, "Smart Entry", timeframe),
          recommendationVersion: "1.0",
          generatedAt: new Date(),
          analyticsVersion: "1.0",
          status: "ACTIVE",
          category: "Smart Entry",
          title,
          priority: "MEDIUM",
          confidence: data.confidence,
          impact: "LOW",
          evidenceSummary: `${strat} entry win rate is ${(data.winRate * 100).toFixed(1)}% with net profit of ${data.profit} USD.`,
          explanation: `${strat} entries are underperforming, often leading to poor execution or premature stop outs. Re-evaluate the slippage configurations.`,
          supportingStatistics: { strategy: strat, winRate: data.winRate, profit: data.profit, count: data.tradeCount },
          timeframe
        });
      }
    }
  });

  // ==========================================
  // 6. Lifecycle Recommendations
  // ==========================================
  const totalAvgWinRate = report.overall.winRate;
  if (report.lifecycle.breakEven.tradeCount >= 3) {
    const data = report.lifecycle.breakEven;
    if (data.winRate > totalAvgWinRate) {
      const title = "Standardize Break-Even Triggers in Position Sizing";
      recs.push({
        recommendationId: generateDeterministicId(title, "Lifecycle", timeframe),
        recommendationVersion: "1.0",
        generatedAt: new Date(),
        analyticsVersion: "1.0",
        status: "ACTIVE",
        category: "Lifecycle",
        title,
        priority: "LOW",
        confidence: "MEDIUM",
        impact: "MEDIUM",
        evidenceSummary: `Trades with break-even triggered achieved ${(data.winRate * 100).toFixed(1)}% win rate vs system average of ${(totalAvgWinRate * 100).toFixed(1)}%.`,
        explanation: `Utilizing break-even protection triggers correlates with higher overall trade viability. It is recommended to standardize break-even rule activation to shield capital.`,
        supportingStatistics: { breakEvenWinRate: data.winRate, systemWinRate: totalAvgWinRate, count: data.tradeCount },
        timeframe
      });
    }
  }
  if (report.lifecycle.partialTP.tradeCount >= 3) {
    const data = report.lifecycle.partialTP;
    if (data.winRate > totalAvgWinRate) {
      const title = "Incorporate Partial Take-Profit Targets";
      recs.push({
        recommendationId: generateDeterministicId(title, "Lifecycle", timeframe),
        recommendationVersion: "1.0",
        generatedAt: new Date(),
        analyticsVersion: "1.0",
        status: "ACTIVE",
        category: "Lifecycle",
        title,
        priority: "LOW",
        confidence: "MEDIUM",
        impact: "MEDIUM",
        evidenceSummary: `Trades with partial profit scaling win rate is ${(data.winRate * 100).toFixed(1)}% vs system average ${(totalAvgWinRate * 100).toFixed(1)}%.`,
        explanation: `Locking in partial profits at TP1 increases consistency. Integrating a two-step partial profit take-profit scheme will yield more stable growth curves.`,
        supportingStatistics: { partialTPWinRate: data.winRate, systemWinRate: totalAvgWinRate, count: data.tradeCount },
        timeframe
      });
    }
  }

  // ==========================================
  // 7. Strategy Recommendations
  // ==========================================
  const db = report.dashboard;
  if (db.mostProfitableStrategy !== "N/A" && db.mostProfitableStrategy !== "Unknown") {
    const strat = db.mostProfitableStrategy;
    const title = `Focus Sizing Schedulers on Most Profitable Entry Method: ${strat}`;
    recs.push({
      recommendationId: generateDeterministicId(title, "Strategy", timeframe),
      recommendationVersion: "1.0",
      generatedAt: new Date(),
      analyticsVersion: "1.0",
      status: "ACTIVE",
      category: "Strategy",
      title,
      priority: "LOW",
      confidence: "LOW",
      impact: "LOW",
      evidenceSummary: `${strat} strategy identified as the most profitable historical option.`,
      explanation: `Historical rankings identify ${strat} as the most profitable entry strategy. Allocating resources to support setups executing under ${strat} is advised.`,
      supportingStatistics: { bestStrategy: strat },
      timeframe
    });
  }

  // ==========================================
  // 8. System Health Recommendations
  // ==========================================
  if (totalTrades < 15) {
    const title = "Collect More Trade History for High-Confidence Analytics";
    recs.push({
      recommendationId: generateDeterministicId(title, "System Health", timeframe),
      recommendationVersion: "1.0",
      generatedAt: new Date(),
      analyticsVersion: "1.0",
      status: "ACTIVE",
      category: "System Health",
      title,
      priority: "MEDIUM",
      confidence: "LOW",
      impact: "LOW",
      evidenceSummary: `The total trade count is only ${totalTrades} trades.`,
      explanation: `Although the engine generated advisory suggestions, the sample size remains low. Standard statistical significance is achieved after 15 completed trades. Keep collecting logs.`,
      supportingStatistics: { totalTrades },
      timeframe
    });
  }

  // Conflict Resolution Pass
  const resolvedRecs = detectAndResolveConflicts(recs);

  return phoenixDeepFreeze(resolvedRecs);
}

/**
 * Persists the recommendations, marking older active advisory entries as SUPERSEDED.
 * 
 * @param {Array} recs - Recommendation documents to save
 * @returns {Promise<Array>} List of saved/updated documents
 */
export async function saveRecommendationsToLedger(recs) {
  const isMongoConnected = mongoose.connection.readyState === 1;
  const processed = [];

  for (const r of recs) {
    if (isMongoConnected) {
      // Transition previous active recommendations targeting the same title/category to SUPERSEDED
      await PhoenixRecommendation.updateMany(
        { category: r.category, title: r.title, status: "ACTIVE" },
        { $set: { status: "SUPERSEDED" } }
      );
      
      // Unique check
      const exists = await PhoenixRecommendation.findOne({ recommendationId: r.recommendationId });
      if (!exists) {
        const newDoc = new PhoenixRecommendation(r);
        const saved = await newDoc.save();
        processed.push(saved.toObject());
      } else {
        processed.push(exists.toObject());
      }
    } else {
      // Local cache transitions
      Array.from(localPhoenixRecommendations.values()).forEach(prev => {
        if (prev.category === r.category && prev.title === r.title && prev.status === "ACTIVE") {
          // Temporarily clone and replace status locally since frozen
          const updated = { ...prev, status: "SUPERSEDED" };
          localPhoenixRecommendations.set(prev.recommendationId, phoenixDeepFreeze(updated));
        }
      });
      
      if (!localPhoenixRecommendations.has(r.recommendationId)) {
        const frozen = phoenixDeepFreeze({ ...r });
        localPhoenixRecommendations.set(r.recommendationId, frozen);
        processed.push(frozen);
      } else {
        processed.push(localPhoenixRecommendations.get(r.recommendationId));
      }
    }
  }
  return phoenixDeepFreeze(processed);
}

/**
 * Query recommendations history (Read-Only)
 */
export async function getRecommendations(filter = {}, options = {}) {
  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    const query = PhoenixRecommendation.find(filter);
    if (options.sort) query.sort(options.sort);
    if (options.limit) query.limit(options.limit);
    if (options.skip) query.skip(options.skip);

    const docs = await query.exec();
    return phoenixDeepFreeze(docs.map(doc => doc.toObject()));
  } else {
    let list = Array.from(localPhoenixRecommendations.values());
    
    Object.keys(filter).forEach(key => {
      list = list.filter(item => {
        const val = item[key];
        return val === filter[key];
      });
    });

    if (options.limit) {
      list = list.slice(0, options.limit);
    }
    return phoenixDeepFreeze(list);
  }
}
