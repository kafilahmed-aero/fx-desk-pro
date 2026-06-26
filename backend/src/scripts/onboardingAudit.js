import "dotenv/config";
import { connectTelegramWithSavedSession } from "../services/telegramService.js";
import { classifyMessage } from "../parsers/noiseFilter.js";
import { parseSignalMessage } from "../parsers/signalParser.js";
import { hasTradingPair } from "../parsers/pairDetector.js";
import fs from "node:fs";
import path from "node:path";


const channels = [
  "thelimitlessfx",
  "Xauusd_Gold_Vip100",
  "forexero",
  "goldtradersunny",
  "tradehubetrade_1778",
  "XAUUSD_SIGNALS222",
  "fxprofitpoint",
  "Tradewithkhadim876",
  "GoldPipsTradeHub",
  "MrHenrys122",
  "GOLDSNNPER786",
  "Technicalpipshuk_786",
  "Staradcmey50",
  "ViewXuk50",
  "GoldInsighthub525",
  "Majid_GoldTechnical",
  "Xauuzsdking",
  "tradewithkhalidfx1",
  "Forex_Kingfxhuk786",
  "XAUUSD_KING_SCALPERS",
  "nassniperhuk50",
  "GOLDANALYSISEXPERTi1",
  "Goldvlp7",
  "TRADEWITHUK500",
  "SmartMoneySmart837",
  "GFR_ANALYSIS",
  "Goldpipsthe2",
  "Pro_faxc_2acdemy",
  "danifx08",
  "goldprotradertame",
  "FOREX_MARKET_CNP0",
  "Aliwithtrade71",
  "xauuusdpipsocietyofficial",
  "pureblizzfx",
  "GolddExpert",
  "TheKingOfForexXPro",
  "EasyForexPips",
  "arshafokuscapital",
  "Wolfforextrading1",
  "wfr_analysis",
  "GOLDTRADERJACK510"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  console.log("=== Telegram Channel Deep Onboarding Audit (100 Messages) ===");
  console.log("Connecting to Telegram...");
  let client;
  try {
    client = await connectTelegramWithSavedSession();
    console.log("Telegram Connected successfully.");
  } catch (error) {
    console.error("Failed to connect to Telegram with saved session:", error.message);
    process.exit(1);
  }

  const results = [];

  for (const channelName of channels) {
    console.log(`\nAuditing channel: @${channelName}...`);
    let status = "RESOLVED";
    let channelTitle = channelName;
    let messages = [];
    
    // Phase 1: Resolve Channel Entity & Fetch 100 Messages
    try {
      const entity = await client.getEntity(channelName);
      channelTitle = entity.title || entity.username || channelName;
      
      messages = await client.getMessages(entity, { limit: 100 });
      console.log(`  Resolved. Title: "${channelTitle}". Fetched ${messages.length} messages.`);
    } catch (error) {
      const msg = error.message || String(error);
      console.error(`  Failed to resolve/fetch: ${msg}`);
      if (msg.includes("FLOOD_WAIT")) {
        status = "FLOOD_WAIT";
        const waitMatch = msg.match(/wait of (\d+)/i);
        const waitSec = waitMatch ? parseInt(waitMatch[1], 10) : 15;
        console.log(`  Waiting ${waitSec}s due to flood wait...`);
        await sleep(waitSec * 1000);
      } else if (msg.includes("CHANNEL_PRIVATE") || msg.includes("invite hash") || msg.includes("ChatAdminRequired")) {
        status = "PRIVATE";
      } else if (msg.includes("USERNAME_NOT_OCCUPIED") || msg.includes("Cannot find any entity")) {
        status = "INVALID";
      } else if (msg.includes("ACCESS_DENIED")) {
        status = "ACCESS_DENIED";
      } else {
        status = "INVALID";
      }
    }

    if (status !== "RESOLVED") {
      results.push({
        channel: channelName,
        status,
        channelTitle,
        totalMessages: 0,
        classifications: { signals: 0, updates: 0, promo: 0, analysis: 0, news: 0, noise: 0 },
        parserStats: { intendedSignals: 0, actionableSignals: 0, successRate: 0, failures: [], unparsedSamples: [] },
        frequency: { daily: 0, weekly: 0 },
        valueCategory: "REJECT",
        reasons: [`Resolution failed: ${status}`]
      });
      await sleep(1500); // polite delay
      continue;
    }

    // Phase 2: Message Analysis & Parser Compatibility
    let candidateSignalsCount = 0;
    let successfullyParsedCount = 0;
    let resultsUpdatesCount = 0;
    let promotionsCount = 0;
    let noiseCommunityCount = 0;

    let parsingFailures = [];
    let signalFormats = new Set();

    const totalMessagesAnalyzed = messages.length;

    for (const msg of messages) {
      const text = msg.message || "";
      if (!text.trim()) {
        noiseCommunityCount++;
        continue;
      }

      const rawMessage = {
        channel: channelName,
        messageId: msg.id,
        text: text,
        hasText: true,
        timestamp: new Date(msg.date * 1000).toISOString(),
      };

      const classRes = classifyMessage(rawMessage);

      // Mutually Exclusive Classification
      let category = "NOISE"; // Default fallback

      // 1. Check if Results / Updates
      const isResultOrUpdate = /\b(TP\d*|SL|TARGET|STOP\s*LOSS)\s+HIT\b|\bHIT\s+(TP\d*|SL|TARGET|STOP\s*LOSS)\b|\b(BOOK|SECURE)\s+(PARTIALS?|PROFITS?)\b|\b(MOVE\s+SL|BREAK\s*EVEN|TRAIL\s+SL|TRAIL\s+STOP|CLOSE\s+PARTIAL|CLOSE\s+NOW|EXIT\s+NOW|HOLD\s+TRADE|CANCEL|CANCELLED|DELETE\s+SETUP|IGNORE\s+SETUP)\b|\bRUNNING\s+\d+\s+PIPS?\b|\b(STOPPED|STOPED)\s+OUT\b|\bPERFORMANCE\b|\bWIN\b/i.test(text) ||
                               ["RESULT_SIGNAL", "UPDATE_SIGNAL"].includes(classRes.classification);

      // 2. Check if Candidate Trade Signal
      const parsed = parseSignalMessage(rawMessage, "NEW_SIGNAL");
      const isParsedSuccessfully = parsed && parsed.parserClassification === "NEW_SIGNAL";

      // Signal keywords as specified by the user request
      const signalKeywords = ["BUY", "SELL", "BUY NOW", "SELL NOW", "LONG", "SHORT", "ENTRY", "ZONE", "TP", "SL", "STOP LOSS", "RISK PRICE"];
      const hasSignalKeywords = signalKeywords.some(kw => new RegExp(`\\b${kw.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
      const hasPair = hasTradingPair(text) || (channelName === "arixanderxx7");

      const isPromo = /\b(VIP|PREMIUM|SUBSCRIBE|MENTORSHIP|BROKER|PAYMENT|REFERRAL|PROMO)\b|\bJOIN\s+NOW\b|\bCONTACT\s+ADMIN\b/i.test(text) ||
                      classRes.classification === "PROMO";

      const isNews = classRes.classification === "NEWS" && !isParsedSuccessfully;

      if (isResultOrUpdate) {
        category = "RESULT_UPDATE";
      } else if (isParsedSuccessfully || (hasPair && hasSignalKeywords && !isNews)) {
        category = "CANDIDATE_SIGNAL";
      } else if (isPromo) {
        category = "PROMO";
      } else {
        category = "NOISE";
      }

      // Process counters and track parsed vs candidate failed signals
      if (category === "CANDIDATE_SIGNAL") {
        candidateSignalsCount++;
        if (isParsedSuccessfully) {
          successfullyParsedCount++;
          const cleanFmt = `PAIR: ${parsed.pair} | ACTION: ${parsed.action} | ENTRY: ${parsed.entry} | TP: ${parsed.targets.join(",")} | SL: ${parsed.stopLoss}`;
          signalFormats.add(cleanFmt);
        } else {
          // Track candidate signal failure details
          const missing = [];
          if (!parsed.pair || parsed.pair === "unknown") missing.push("pair");
          if (!parsed.action) missing.push("action");
          if (parsed.entry === null || parsed.entry === undefined) missing.push("entry");
          if (!parsed.targets || parsed.targets.length === 0) missing.push("targets");
          if (parsed.stopLoss === null || parsed.stopLoss === undefined) missing.push("stopLoss");

          parsingFailures.push({
            id: msg.id,
            text: text,
            missing
          });
        }
      } else if (category === "RESULT_UPDATE") {
        resultsUpdatesCount++;
      } else if (category === "PROMO") {
        promotionsCount++;
      } else {
        noiseCommunityCount++;
      }
    }

    // Success Rate (Signal Parse Accuracy)
    const signalParseAccuracy = candidateSignalsCount > 0
      ? Math.round((successfullyParsedCount / candidateSignalsCount) * 100)
      : 100;

    // Signal Frequency Calculation based on oldest and newest timestamp
    let signalsPerDay = 0;
    let signalsPerWeek = 0;
    if (messages.length > 1) {
      const newestMsg = messages[0];
      const oldestMsg = messages[messages.length - 1];
      const newestTime = newestMsg.date * 1000;
      const oldestTime = oldestMsg.date * 1000;
      const timespanMs = Math.max(1, newestTime - oldestTime);
      const daysSpan = timespanMs / (1000 * 60 * 60 * 24);
      if (daysSpan > 0.05) {
        signalsPerDay = parseFloat((candidateSignalsCount / daysSpan).toFixed(2));
        signalsPerWeek = parseFloat((signalsPerDay * 7).toFixed(2));
      }
    }

    // Recommendation logic based solely on Signal Parse Accuracy
    let recommendation = "INVESTIGATE PARSER GAPS";
    if (signalParseAccuracy >= 90) {
      recommendation = "EXCELLENT";
    } else if (signalParseAccuracy >= 70) {
      recommendation = "SAFE TO ADD";
    } else if (signalParseAccuracy >= 50) {
      recommendation = "ADD WITH PARSER IMPROVEMENTS";
    } else {
      recommendation = "INVESTIGATE PARSER GAPS";
    }

    const uniqueFormats = Array.from(signalFormats).slice(0, 2);

    results.push({
      channel: channelName,
      status: "RESOLVED",
      channelTitle,
      totalMessages: totalMessagesAnalyzed,
      classifications: {
        candidateSignals: candidateSignalsCount,
        successfullyParsed: successfullyParsedCount,
        resultsUpdates: resultsUpdatesCount,
        promotions: promotionsCount,
        noiseCommunity: noiseCommunityCount
      },
      parserStats: {
        accuracy: signalParseAccuracy,
        failures: parsingFailures
      },
      frequency: {
        daily: signalsPerDay,
        weekly: signalsPerWeek
      },
      recommendation,
      formats: uniqueFormats.length > 0 ? uniqueFormats : ["N/A"]
    });

    console.log(`  Done. Candidate: ${candidateSignalsCount}, Parsed: ${successfullyParsedCount}, Accuracy: ${signalParseAccuracy}%, Freq: ${signalsPerDay}/day, Recommendation: ${recommendation}`);
    await sleep(1500); // polite delay
  }

  // Save the raw results JSON
  const auditReportPath = path.resolve("deep_channel_audit_results.json");
  fs.writeFileSync(auditReportPath, JSON.stringify(results, null, 2));
  console.log(`\nDeep audit finished! Raw results written to: ${auditReportPath}`);

  // Generate rankings and recommendations sorted by Parse Accuracy
  const sortedChannels = [...results].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "RESOLVED" ? -1 : 1;
    }
    if (a.parserStats.accuracy !== b.parserStats.accuracy) {
      return b.parserStats.accuracy - a.parserStats.accuracy;
    }
    return b.classifications.successfullyParsed - a.classifications.successfullyParsed;
  });

  const top10 = sortedChannels.filter(c => c.status === "RESOLVED").slice(0, 10);
  const recommendedAdditions = sortedChannels.filter(c => c.recommendation === "EXCELLENT" || c.recommendation === "SAFE TO ADD");
  const attentionRequired = sortedChannels.filter(c => c.recommendation === "ADD WITH PARSER IMPROVEMENTS");
  const investigateRequired = sortedChannels.filter(c => c.recommendation === "INVESTIGATE PARSER GAPS" || c.status !== "RESOLVED");

  // Phase 5: Generate the Final Report markdown
  let mdReport = `# Deep Channel Onboarding Audit Report (100 Messages)

Audited **${channels.length}** candidate Telegram channels for resolution, signal density, signal parse accuracy, and promotional noise.

---

## 🏆 Final Rankings (Top 10 Channels)

| Rank | Channel | Title | Parse Accuracy | Parsed / Candidates | Signals/Day | Recommendation |
|------|---------|-------|----------------|---------------------|-------------|----------------|
`;

  top10.forEach((r, idx) => {
    mdReport += `| ${idx + 1} | **@${r.channel}** | ${r.channelTitle} | ${r.parserStats.accuracy}% | ${r.classifications.successfullyParsed}/${r.classifications.candidateSignals} | ${r.frequency.daily} | ${r.recommendation} |\n`;
  });

  mdReport += `
---

## 🚦 Final Recommendations

### 🟢 EXCELLENT & SAFE TO ADD (Accuracy >= 70%)
${recommendedAdditions.map(r => `- **@${r.channel}** ("${r.channelTitle}"): Parse accuracy **${r.parserStats.accuracy}%** (${r.classifications.successfullyParsed}/${r.classifications.candidateSignals} parsed) | **${r.frequency.daily}** signals/day | Recommendation: **${r.recommendation}**`).join("\n") || "*None*"}

### 🟡 ADD WITH PARSER IMPROVEMENTS (Accuracy 50-69%)
${attentionRequired.map(r => `- **@${r.channel}** ("${r.channelTitle}"): Parse accuracy **${r.parserStats.accuracy}%** (${r.classifications.successfullyParsed}/${r.classifications.candidateSignals} parsed) | **${r.frequency.daily}** signals/day`).join("\n") || "*None*"}

### 🔴 INVESTIGATE PARSER GAPS (Accuracy < 50%)
${investigateRequired.map(r => `- **@${r.channel}** ("${r.channelTitle}"): ${r.status !== "RESOLVED" ? `Status: **${r.status}**` : `Parse accuracy **${r.parserStats.accuracy}%** (${r.classifications.successfullyParsed}/${r.classifications.candidateSignals} parsed) | **${r.frequency.daily}** signals/day`}`).join("\n") || "*None*"}

---

## 📄 Detailed Per-Channel Report

`;

  results.forEach(r => {
    const commonFailures = [];
    const failures = r.parserStats.failures || [];
    if (failures.length > 0) {
      const allMissing = [...new Set(failures.flatMap(f => f.missing))];
      allMissing.forEach(m => {
        if (m === "entry") commonFailures.push("Missing Entry");
        else if (m === "stopLoss") commonFailures.push("Missing Stop Loss");
        else if (m === "targets") commonFailures.push("Missing Targets");
        else commonFailures.push(`Missing ${m}`);
      });
      if (failures.some(f => /buy\s+now|sell\s+now/i.test(f.text))) {
        commonFailures.push("Buy Now alerts");
      }
    }

    mdReport += `### CHANNEL: @${r.channel}
**TITLE**: ${r.channelTitle}

Messages Analysed: ${r.totalMessages}

Candidate Trade Signals: ${r.classifications.candidateSignals}
Results / Updates: ${r.classifications.resultsUpdates}
Promotions: ${r.classifications.promotions}
Noise / Community Posts: ${r.classifications.noiseCommunity}

Signal Parse Accuracy:
${r.parserStats.accuracy}%

Common Problems:
${commonFailures.length > 0 ? commonFailures.join(", ") : "None"}

Typical Signal Format:
\`${r.formats[0]}\`

Recommendation:
${r.recommendation}

`;

    if (failures.length > 0) {
      mdReport += `#### FAILED SIGNAL EXAMPLES\n\n`;
      failures.slice(0, 5).forEach((f, index) => {
        const reason = determineFailureReason(f.text);
        mdReport += `* **Example ${index + 1}** (ID: ${f.id})
  Message: \`${f.text.replace(/\n/g, " | ")}\`
  Likely Reason: **${reason}**\n\n`;
      });
    }

    mdReport += `---\n\n`;
  });

  // Write markdown report to artifacts folder using standard slashes
  const artifactsDir = "C:/Users/Lenovo/.gemini/antigravity-ide/brain/a4b8892d-18ec-40d8-9dd8-cdc1f4ecd1e8";
  if (fs.existsSync(artifactsDir)) {
    fs.writeFileSync(path.join(artifactsDir, "deep_channel_audit_report.md"), mdReport);
    console.log(`Markdown report written to: ${path.join(artifactsDir, "deep_channel_audit_report.md")}`);
  } else {
    fs.writeFileSync("deep_channel_audit_report.md", mdReport);
    console.log(`Markdown report written to: deep_channel_audit_report.md`);
  }

  // Close Telegram Client
  await client.destroy();
  console.log("Telegram client destroyed.");
}

function determineFailureReason(text) {
  const upper = text.toUpperCase();
  const reasons = [];
  if (upper.includes("ZONE")) {
    reasons.push("Zone format unsupported");
  }
  if (upper.includes("RISK PRICE") || upper.includes("RISKPRICE")) {
    reasons.push("Risk Price unsupported");
  }
  if (/\b\d\s*[_.)-]\s*TP\b/i.test(text) || /\b\d\s*[_.)-]\s*TARGET\b/i.test(text) || /\bTP\s*\d\b/i.test(text) || /\bTARGET\s*\d\b/i.test(text)) {
    reasons.push("1_TP format unsupported");
  }
  if (/\bXAU\s*[/]?\s*USD\b/i.test(text) || /\bXAU-USD\b/i.test(text)) {
    reasons.push("XAU/USD normalization issue");
  }
  if (reasons.length === 0) {
    reasons.push("Other");
  }
  return reasons.join(", ");
}

run().catch((err) => {
  console.error("Process error:", err);
  process.exit(1);
});
