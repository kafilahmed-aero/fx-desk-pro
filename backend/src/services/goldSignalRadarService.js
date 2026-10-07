import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getPairState } from "./pairStateEngine.js";

// Rolling 24h window for VIP signals to guarantee strictly 10 to 20 signals/day
const vipSignalTimestamps = [];

// Cache of recently broadcast messageKeys to prevent duplicate alerts
const recentBroadcastKeys = new Set();
const MAX_CACHE_SIZE = 500;

/**
 * Evaluates whether a signal meets the 4-Gate VIP model.
 * 
 * Gate 1 (Controlled Risk): SL distance between 20 and 80 pips ($2.00 to $8.00 on Gold)
 * Gate 2 (Meaningful Target): TP1 distance >= 25 pips (>= $2.50 on Gold)
 * Gate 3 (Data Completeness): Valid numerical Entry, SL, and at least 2 distinct TPs
 * Gate 4 (High Conviction): Multi-channel agreement >= 2 OR RRR >= 1.3
 * 
 * @param {object} signal - Stored parsed signal
 * @param {object} pairState - Live pair state (for consensus clustering)
 * @returns {object} Evaluation results
 */
export function evaluateSignalQuality(signal, pairState = null) {
  const pair = String(signal.pair || "").toUpperCase();
  const isGold = pair === "XAUUSD" || pair === "GOLD";

  // Resolve numerical entry
  let entry = null;
  if (Number.isFinite(Number(signal.entry)) && Number(signal.entry) > 0) {
    entry = Number(signal.entry);
  } else if (Array.isArray(signal.entryRange) && signal.entryRange.length > 0) {
    const validNums = signal.entryRange.map(Number).filter(n => Number.isFinite(n) && n > 0);
    if (validNums.length > 0) {
      entry = (validNums[0] + validNums[validNums.length - 1]) / 2;
    }
  }

  const stopLoss = Number.isFinite(Number(signal.stopLoss)) && Number(signal.stopLoss) > 0
    ? Number(signal.stopLoss)
    : null;

  const validTargets = (Array.isArray(signal.targets) ? signal.targets : [])
    .map(Number)
    .filter(n => Number.isFinite(n) && n > 0);

  // Gate 3: Completeness
  const hasValidAction = signal.action === "BUY" || signal.action === "SELL";
  const gate3Completeness = Boolean(entry && stopLoss && validTargets.length >= 2 && hasValidAction);

  if (!gate3Completeness) {
    return {
      isVip: false,
      isGold,
      entry,
      stopLoss,
      targets: validTargets,
      riskPips: null,
      rewardPips: null,
      rrr: null,
      consensusCount: 1,
      rejectionReason: "GATE3_INCOMPLETE_LEVELS",
    };
  }

  // Calculate Pip metrics (for Gold, $0.10 = 1 pip, $1.00 = 10 pips)
  // For standard 4/5-digit forex, 0.0001 = 1 pip; for JPY, 0.01 = 1 pip
  const pipMultiplier = isGold ? 10 : (pair.includes("JPY") ? 100 : 10000);

  const risk = Math.abs(entry - stopLoss);
  const riskPips = Math.round(risk * pipMultiplier);

  const tp1 = validTargets[0];
  const reward = Math.abs(tp1 - entry);
  const rewardPips = Math.round(reward * pipMultiplier);

  const rrr = risk > 0 ? Number((reward / risk).toFixed(2)) : 0;

  // Gate 1: Controlled Risk (20 to 80 pips / $2.00 to $8.00 on Gold)
  const gate1Risk = riskPips >= 20 && riskPips <= 80;

  // Gate 2: Meaningful Target (TP1 >= 25 pips)
  const gate2Reward = rewardPips >= 25;

  // Gate 4: High Conviction (Consensus >= 2 OR RRR >= 1.3)
  const consensusCount = pairState?.activeSignalsCount || pairState?.signalCount || 1;
  const gate4Conviction = consensusCount >= 2 || rrr >= 1.3;

  // Rolling 24-hour daily quota check
  const now = Date.now();
  pruneVipTimestamps(now);
  const maxVipDaily = config.goldRadar?.maxVipPerDay || 20;
  const quotaAvailable = vipSignalTimestamps.length < maxVipDaily;

  const passesAllGates = gate1Risk && gate2Reward && gate3Completeness && gate4Conviction;
  const isVip = passesAllGates && quotaAvailable;

  let rejectionReason = null;
  if (!gate1Risk) rejectionReason = `GATE1_RISK_OUT_OF_BOUNDS_${riskPips}PIPS`;
  else if (!gate2Reward) rejectionReason = `GATE2_REWARD_TOO_SMALL_${rewardPips}PIPS`;
  else if (!gate4Conviction) rejectionReason = `GATE4_LOW_CONVICTION_RRR_${rrr}`;
  else if (!quotaAvailable) rejectionReason = "VIP_DAILY_QUOTA_REACHED";

  return {
    isVip,
    isGold,
    entry: Number(entry.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    targets: validTargets.map(t => Number(t.toFixed(2))),
    riskPips,
    rewardPips,
    rrr,
    consensusCount,
    rejectionReason,
    currentVipDailyCount: vipSignalTimestamps.length,
  };
}

/**
 * Cleans up timestamps older than 24 hours.
 */
function pruneVipTimestamps(now = Date.now()) {
  const cutoff = now - 24 * 60 * 60 * 1000;
  while (vipSignalTimestamps.length > 0 && vipSignalTimestamps[0] < cutoff) {
    vipSignalTimestamps.shift();
  }
}

/**
 * Builds the VIP high-conviction HTML message.
 */
function buildVipMessage(signal, evaluation) {
  const actionEmoji = signal.action === "BUY" ? "🟢 BUY" : "🔴 SELL";
  const entryText = Array.isArray(signal.entryRange) && signal.entryRange.length === 2
    ? `${signal.entryRange[0]} - ${signal.entryRange[1]} (Avg ${evaluation.entry})`
    : `${evaluation.entry}`;

  const targetsHtml = evaluation.targets
    .map((target, idx) => {
      const isLast = idx === evaluation.targets.length - 1;
      const prefix = isLast ? "└" : "├";
      const pipGain = Math.round(Math.abs(target - evaluation.entry) * (evaluation.isGold ? 10 : 10000));
      return `  ${prefix} <b>TP${idx + 1}:</b> <code>${target}</code> (+${pipGain} pips)`;
    })
    .join("\n");

  const timeStr = new Date().toLocaleTimeString("en-US", { timeZone: "UTC", hour12: false }) + " UTC";

  return `👑 <b>GOLD SIGNAL RADAR™ [VIP CONSENSUS]</b>
━━━━━━━━━━━━━━━━━━━━
⚡ <b>HIGH CONVICTION SETUP</b>

🎯 <b>PAIR:</b> <code>${signal.pair}</code>
📊 <b>ACTION:</b> ${actionEmoji}
📍 <b>ENTRY ZONE:</b> <code>${entryText}</code>
🛑 <b>STOP LOSS:</b> <code>${evaluation.stopLoss}</code> (${evaluation.riskPips} pips)

🎯 <b>TARGETS:</b>
${targetsHtml}

📈 <b>RISK / REWARD:</b> 1:${evaluation.rrr}
🔥 <b>CONSENSUS:</b> ${evaluation.consensusCount} Provider Agreement
⏱️ <b>TIME:</b> ${timeStr}
━━━━━━━━━━━━━━━━━━━━
🔒 <i>Exclusive VIP Algorithmic Delivery</i>`;
}

/**
 * Builds the Public free signal HTML message.
 */
function buildPublicMessage(signal, evaluation) {
  const actionEmoji = signal.action === "BUY" ? "🟢 BUY" : "🔴 SELL";
  const entryText = Array.isArray(signal.entryRange) && signal.entryRange.length === 2
    ? `${signal.entryRange[0]} - ${signal.entryRange[1]}`
    : (evaluation.entry || signal.entry || "Market Execution");

  const stopLossText = evaluation.stopLoss || signal.stopLoss || "Manual / Trailing";

  let targetsHtml = "";
  if (evaluation.targets && evaluation.targets.length > 0) {
    targetsHtml = evaluation.targets
      .map((target, idx) => {
        const isLast = idx === evaluation.targets.length - 1;
        const prefix = isLast ? "└" : "├";
        return `  ${prefix} <b>TP${idx + 1}:</b> <code>${target}</code>`;
      })
      .join("\n");
  } else {
    targetsHtml = "  └ <b>TP:</b> <code>Open / Discretionary</code>";
  }

  const timeStr = new Date().toLocaleTimeString("en-US", { timeZone: "UTC", hour12: false }) + " UTC";
  const vipInviteLink = config.goldRadar?.vipInviteLink || "https://t.me/+48_7Kzcq_WZhYWI1";

  return `📡 <b>GOLD SIGNAL RADAR™ [PUBLIC STREAM]</b>
━━━━━━━━━━━━━━━━━━━━
⚡ <b>FREE MARKET SIGNAL</b>

🎯 <b>PAIR:</b> <code>${signal.pair || "XAUUSD"}</code>
📊 <b>ACTION:</b> ${actionEmoji}
📍 <b>ENTRY:</b> <code>${entryText}</code>
🛑 <b>STOP LOSS:</b> <code>${stopLossText}</code>

🎯 <b>TARGETS:</b>
${targetsHtml}

📡 <b>SOURCE:</b> Verified Aggregated Stream
⏱️ <b>TIME:</b> ${timeStr}
━━━━━━━━━━━━━━━━━━━━
👑 <b>Want only 10-20 High-Conviction setups with multi-provider consensus & tight SL?</b>
👉 <b>Join VIP Terminal:</b> <a href="${vipInviteLink}">Access VIP Here</a>`;
}

/**
 * Main ingestion handler for Gold Signal Radar.
 * Fully isolated from the brother's alert board.
 * 
 * @param {object} storedParsedSignal - Incoming parsed signal
 */
export async function processGoldRadarSignal(storedParsedSignal) {
  try {
    if (!storedParsedSignal || storedParsedSignal.classification !== "NEW_SIGNAL") {
      return;
    }

    const { botToken, vipChannelId, publicChannelId } = config.goldRadar || {};
    if (!botToken || !vipChannelId || !publicChannelId) {
      logger.warn("gold_radar.skipped_missing_credentials");
      return;
    }

    const messageKey = `${storedParsedSignal.channel}:${storedParsedSignal.messageId}`;
    if (recentBroadcastKeys.has(messageKey)) {
      return;
    }
    recentBroadcastKeys.add(messageKey);
    if (recentBroadcastKeys.size > MAX_CACHE_SIZE) {
      const first = recentBroadcastKeys.values().next().value;
      recentBroadcastKeys.delete(first);
    }

    // Get live pair state to check consensus clustering
    let pairState = null;
    try {
      pairState = getPairState(storedParsedSignal.pair);
    } catch (e) {
      // Non-blocking
    }

    // Evaluate signal quality using 4-Gate Model
    const evaluation = evaluateSignalQuality(storedParsedSignal, pairState);

    logger.info("gold_radar.signal_evaluated", {
      messageKey,
      pair: storedParsedSignal.pair,
      action: storedParsedSignal.action,
      isVip: evaluation.isVip,
      rejectionReason: evaluation.rejectionReason,
      riskPips: evaluation.riskPips,
      rewardPips: evaluation.rewardPips,
      rrr: evaluation.rrr,
      consensusCount: evaluation.consensusCount,
      vipDailyCount: evaluation.currentVipDailyCount,
    });

    let targetChatId = null;
    let messageText = null;

    if (evaluation.isVip) {
      // MUTUAL EXCLUSION: VIP goes ONLY to VIP channel
      targetChatId = vipChannelId;
      messageText = buildVipMessage(storedParsedSignal, evaluation);
      vipSignalTimestamps.push(Date.now());
    } else {
      // MUTUAL EXCLUSION: Non-VIP goes ONLY to Public channel
      targetChatId = publicChannelId;
      messageText = buildPublicMessage(storedParsedSignal, evaluation);
    }

    // Send Telegram broadcast
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: messageText,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.error("gold_radar.send_failed", {
        targetChatId,
        isVip: evaluation.isVip,
        status: response.status,
        error: errBody,
      });
      return;
    }

    logger.info("gold_radar.send_success", {
      messageKey,
      channelType: evaluation.isVip ? "VIP" : "PUBLIC",
      targetChatId,
    });
  } catch (error) {
    logger.error("gold_radar.unhandled_error", {
      error: error.message,
    });
  }
}
