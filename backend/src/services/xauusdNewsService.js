import { logger } from "../utils/logger.js";

/**
 * Parses XML RSS feed content using a regex-based RSS parser.
 * Handles CDATA wrapping and HTML stripping.
 * @param {string} xmlText - Raw XML RSS string
 * @returns {Array<Object>} List of parsed items with { title, link, publishedAt, summary }
 */
function parseRss(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];
    
    const titleMatch = itemContent.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = itemContent.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
    const pubDateMatch = itemContent.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/i);
    const descMatch = itemContent.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    
    const title = titleMatch ? titleMatch[1].trim() : "";
    const link = linkMatch ? linkMatch[1].trim() : "";
    const publishedAt = pubDateMatch ? pubDateMatch[1].trim() : "";
    const rawSummary = descMatch ? descMatch[1].trim() : "";
    
    // Clean up summary: strip HTML tags
    let cleanSummary = rawSummary.replace(/<\/?[^>]+(>|$)/g, "").trim();
    if (cleanSummary.length > 300) {
      cleanSummary = cleanSummary.slice(0, 297) + "...";
    }

    items.push({
      title,
      link,
      publishedAt,
      summary: cleanSummary
    });
  }
  return items;
}

/**
 * Validates whether an economic event is USD high-impact based on title keywords and importance status.
 * Covers NFP, CPI, PPI, FOMC, Fed speeches, Interest rate decisions, GDP, and Unemployment.
 * @param {Object} event - Raw calendar event
 * @returns {boolean} True if USD high-impact event
 */
function isHighImpactUSD(event) {
  const country = String(event.country || "").toUpperCase();
  if (country !== "US" && country !== "USD") {
    return false;
  }

  const impact = String(event.impact || "").toUpperCase();
  const importance = event.importance;
  const isHighImpactStatus = impact === "HIGH" || impact === "RED" || importance === 1;

  const title = String(event.title || "");
  const keywords = /(Non-?Farm|NFP|Consumer Price Index|CPI|Producer Price Index|PPI|FOMC|Fed|Federal Reserve|Interest Rate|GDP|Gross Domestic Product|Unemployment|Jobless)/i;
  const matchesKeywords = keywords.test(title);

  return isHighImpactStatus || matchesKeywords;
}

/**
 * Fetches economic events from primary (Forex Factory) or fallback (TradingView).
 * @returns {Promise<Array<Object>>} List of normalized economic events
 */
async function fetchCalendarEvents() {
  // 1. Try Forex Factory (Primary)
  try {
    const res = await fetch("https://nfs.forexfactory.com/ffcal/week/this.json", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (res.ok) {
      const data = await res.json();
      const events = Array.isArray(data) ? data : [];
      return events
        .filter(isHighImpactUSD)
        .map(e => {
          const forecast = e.forecast ? `Forecast: ${e.forecast}` : "";
          const previous = e.previous ? `Previous: ${e.previous}` : "";
          const summaryText = [forecast, previous].filter(Boolean).join(", ");
          return {
            title: e.title,
            source: "Forex Factory",
            impact: "HIGH",
            publishedAt: e.date || new Date().toISOString(),
            summary: summaryText.slice(0, 300)
          };
        });
    } else {
      logger.warn("xauusd_news_service.forex_factory_failed", { status: res.status });
    }
  } catch (err) {
    logger.warn("xauusd_news_service.forex_factory_error", { error: err.message });
  }

  // 2. Try TradingView (Fallback)
  try {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 3); // 3 days ago
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 4); // 4 days forward
    
    const tvUrl = `https://economic-calendar.tradingview.com/events?from=${fromDate.toISOString()}&to=${toDate.toISOString()}`;
    const res = await fetch(tvUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Origin": "https://www.tradingview.com"
      }
    });

    if (res.ok) {
      const data = await res.json();
      const rawEvents = data.result || [];
      return rawEvents
        .filter(isHighImpactUSD)
        .map(e => {
          const actual = e.actual !== undefined && e.actual !== null ? `Actual: ${e.actual}` : "";
          const forecast = e.forecast !== undefined && e.forecast !== null ? `Forecast: ${e.forecast}` : "";
          const previous = e.previous !== undefined && e.previous !== null ? `Previous: ${e.previous}` : "";
          const summaryText = [actual, forecast, previous].filter(Boolean).join(", ");
          return {
            title: e.title,
            source: "TradingView",
            impact: "HIGH",
            publishedAt: e.date || new Date().toISOString(),
            summary: summaryText.slice(0, 300)
          };
        });
    } else {
      logger.warn("xauusd_news_service.tradingview_failed", { status: res.status });
    }
  } catch (err) {
    logger.warn("xauusd_news_service.tradingview_error", { error: err.message });
  }

  return [];
}

/**
 * Fetches gold news headlines from primary (Yahoo Finance) or fallback (Investing.com).
 * @returns {Promise<Array<Object>>} List of normalized news articles
 */
async function fetchGoldNews() {
  // 1. Try Yahoo Finance (Primary)
  try {
    const res = await fetch("https://finance.yahoo.com/rss/headline?s=GC=F", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (res.ok) {
      const xmlText = await res.text();
      const items = parseRss(xmlText);
      return items.map(item => ({
        title: item.title,
        source: "Yahoo Finance",
        impact: "MEDIUM",
        publishedAt: item.publishedAt || new Date().toISOString(),
        summary: item.summary
      }));
    } else {
      logger.warn("xauusd_news_service.yahoo_finance_failed", { status: res.status });
    }
  } catch (err) {
    logger.warn("xauusd_news_service.yahoo_finance_error", { error: err.message });
  }

  // 2. Try Investing.com (Fallback)
  try {
    const res = await fetch("https://www.investing.com/rss/news_287.rss", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (res.ok) {
      const xmlText = await res.text();
      const items = parseRss(xmlText);
      return items.map(item => ({
        title: item.title,
        source: "Investing.com",
        impact: "MEDIUM",
        publishedAt: item.publishedAt || new Date().toISOString(),
        summary: item.summary
      }));
    } else {
      logger.warn("xauusd_news_service.investing_failed", { status: res.status });
    }
  } catch (err) {
    logger.warn("xauusd_news_service.investing_error", { error: err.message });
  }

  return [];
}

/**
 * Fetches latest high-impact economic events and gold news.
 * Guarantees no crashes; always returns a safe fallback object structure if errors occur.
 * @returns {Promise<{highImpactEvents: Array, goldNews: Array}>} Latest news context
 */
export async function getXauusdNewsContext() {
  try {
    const [calendarEvents, newsArticles] = await Promise.all([
      fetchCalendarEvents(),
      fetchGoldNews()
    ]);

    return {
      highImpactEvents: calendarEvents.slice(0, 5),
      goldNews: newsArticles.slice(0, 5)
    };
  } catch (err) {
    logger.error("xauusd_news_service.get_context_failed", { error: err.message });
    return {
      highImpactEvents: [],
      goldNews: []
    };
  }
}
