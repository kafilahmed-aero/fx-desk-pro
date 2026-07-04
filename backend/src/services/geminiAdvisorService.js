import mongoose from "mongoose";
import { config } from "../config/env.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { getParsedSignals } from "./parsedSignalStore.js";
import { getCurrentPrice } from "./priceIngestionService.js";
import { getXauusdNewsContext } from "./xauusdNewsService.js";
import { logger } from "../utils/logger.js";

/**
 * Gets all active XAUUSD parsed signals from the DB or fallback memory store.
 * @returns {Promise<Array>} Array of parsed signals
 */
export async function getActiveXauusdSignals() {
  const isMongoConnected = mongoose.connection.readyState === 1;
  if (isMongoConnected) {
    try {
      return await ParsedSignal.find({
        pair: "XAUUSD",
        signalState: "ACTIVE"
      }).lean();
    } catch (err) {
      logger.error("gemini_advisor.db_query_failed", { error: err.message });
      return [];
    }
  } else {
    try {
      const signals = await getParsedSignals(100, { activeOnly: true });
      return signals.filter(s => s.pair === "XAUUSD" && s.signalState === "ACTIVE");
    } catch (err) {
      logger.error("gemini_advisor.in_memory_query_failed", { error: err.message });
      return [];
    }
  }
}

/**
 * Contacts the Gemini API (gemini-2.5-flash) to get a trade recommendation
 * based on active signals and current price.
 * @returns {Promise<Object>} Recommendation JSON or failure status object
 */
export async function getXauusdRecommendation() {
  try {
    // 1. Check API Key
    if (!config.geminiApiKey) {
      logger.warn("gemini_advisor.missing_api_key");
      return {
        status: "error",
        message: "Gemini recommendation unavailable"
      };
    }

    // 2. Fetch price, signals, and news context
    const priceInfo = await getCurrentPrice("XAUUSD");
    const currentPrice = priceInfo ? priceInfo.price : null;
    const signals = await getActiveXauusdSignals();

    let newsContext = { highImpactEvents: [], goldNews: [] };
    try {
      newsContext = await getXauusdNewsContext();
    } catch (newsErr) {
      logger.warn("gemini_advisor.fetch_news_failed", { error: newsErr.message });
    }

    // 3. Format signals, events, and headlines for the prompt
    const formattedSignals = signals.map((s, idx) => {
      const direction = s.action || "N/A";
      const entry = s.entry !== null ? s.entry : (s.entryRange && s.entryRange.length > 0 ? s.entryRange.join("-") : "N/A");
      const sl = s.stopLoss !== null ? s.stopLoss : (s.effectiveStopLoss !== null ? s.effectiveStopLoss : "N/A");
      const tp = s.targets && s.targets.length > 0
        ? s.targets.map(t => typeof t === "object" ? t.target : t).filter(val => val !== null && val !== undefined).join(", ")
        : (s.target !== null ? s.target : "N/A");
      const channel = s.channelTitle || s.channel || "N/A";
      const timestamp = s.timestamp ? new Date(s.timestamp).toISOString() : "N/A";

      return `Signal #${idx + 1}:
  - Direction: ${direction}
  - Entry: ${entry}
  - SL: ${sl}
  - TP: ${tp}
  - Channel Name: ${channel}
  - Timestamp: ${timestamp}`;
    }).join("\n\n");

    const formattedEvents = newsContext.highImpactEvents && newsContext.highImpactEvents.length > 0
      ? newsContext.highImpactEvents.map((e, idx) => `Event #${idx + 1}:
  - Title: ${e.title}
  - Source: ${e.source}
  - Time/Date: ${e.publishedAt}
  - Impact: ${e.impact}
  - Details: ${e.summary}`).join("\n\n")
      : "None";

    const formattedNews = newsContext.goldNews && newsContext.goldNews.length > 0
      ? newsContext.goldNews.map((n, idx) => `News #${idx + 1}:
  - Title: ${n.title}
  - Source: ${n.source}
  - Time/Date: ${n.publishedAt}
  - Summary: ${n.summary}`).join("\n\n")
      : "None";

    // 4. Build prompt incorporating news context
    const prompt = `You are a professional financial trading advisor specializing in Gold (XAUUSD).
Analyze the current market price, active signals, recent high-impact macroeconomic events, and gold market news to make a trading decision.

CURRENT GOLD PRICE: ${currentPrice !== null ? currentPrice : "Unavailable"}

ACTIVE SIGNALS:
${formattedSignals || "None"}

RECENT HIGH-IMPACT EVENTS:
${formattedEvents}

RECENT GOLD NEWS:
${formattedNews}

Synthesize a consensus trade recommendation based on all the provided information.
Produce your output as a single valid JSON object matching this schema:
{
  "pair": "XAUUSD",
  "direction": "BUY" | "SELL" | "HOLD",
  "entryMin": number (minimum entry price, or current price if HOLD),
  "entryMax": number (maximum entry price, or current price if HOLD),
  "sl": number (stop loss price, or null if HOLD),
  "tp": number (take profit price, or null if HOLD),
  "reasoning": [
    "short bullet-style explanation 1",
    "short bullet-style explanation 2",
    "short bullet-style explanation 3"
  ]
}

Return JSON ONLY. Do NOT enclose the JSON in markdown code blocks like \`\`\`json. Do not include any explanations or other text outside the JSON.`;

    // 5. Call Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.geminiApiKey}`;
    
    logger.info("gemini_advisor.calling_api", { signalCount: signals.length, currentPrice });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (response.status === 429) {
      logger.warn("gemini_advisor.rate_limited");
      return {
        status: "error",
        message: "Gemini recommendation unavailable"
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("gemini_advisor.api_error", { status: response.status, error: errorText });
      return {
        status: "error",
        message: "Gemini recommendation unavailable"
      };
    }

    const data = await response.json();
    let textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResponse) {
      logger.error("gemini_advisor.empty_response", { data });
      return {
        status: "error",
        message: "Gemini recommendation unavailable"
      };
    }

    // Handle potential markdown wrapping
    textResponse = textResponse.trim();
    if (textResponse.startsWith("```")) {
      textResponse = textResponse.replace(/^```(?:json)?\n?|```$/g, "").trim();
    }

    // 6. Parse and Validate response
    const recommendation = JSON.parse(textResponse);

    // Strict schema check: Require all fields to exist and be defined (not undefined)
    if (
      recommendation.pair === undefined ||
      recommendation.direction === undefined ||
      recommendation.entryMin === undefined ||
      recommendation.entryMax === undefined ||
      recommendation.sl === undefined ||
      recommendation.tp === undefined ||
      recommendation.reasoning === undefined
    ) {
      throw new Error("Missing required field in Gemini response");
    }

    if (
      recommendation.pair !== "XAUUSD" ||
      typeof recommendation.direction !== "string" ||
      !Array.isArray(recommendation.reasoning) ||
      recommendation.reasoning.some(r => typeof r !== "string")
    ) {
      throw new Error("Invalid response type or value in Gemini response");
    }

    const entryMin = recommendation.entryMin !== null ? Number(recommendation.entryMin) : null;
    const entryMax = recommendation.entryMax !== null ? Number(recommendation.entryMax) : null;
    const sl = recommendation.sl !== null ? Number(recommendation.sl) : null;
    const tp = recommendation.tp !== null ? Number(recommendation.tp) : null;

    if (
      entryMin === null || Number.isNaN(entryMin) ||
      entryMax === null || Number.isNaN(entryMax) ||
      (sl !== null && Number.isNaN(sl)) ||
      (tp !== null && Number.isNaN(tp))
    ) {
      throw new Error("Invalid numeric value for trade parameters in Gemini response");
    }

    return {
      pair: "XAUUSD",
      direction: recommendation.direction.toUpperCase(),
      entryMin,
      entryMax,
      sl,
      tp,
      reasoning: recommendation.reasoning.map(r => String(r))
    };

  } catch (err) {
    logger.error("gemini_advisor.execution_failed", { error: err.message });
    return {
      status: "error",
      message: "Gemini recommendation unavailable"
    };
  }
}
