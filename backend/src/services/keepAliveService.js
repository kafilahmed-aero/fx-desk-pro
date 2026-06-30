import { logger } from "../utils/logger.js";

let keepAliveInterval = null;

export function startKeepAlive() {
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BACKEND_URL;
  
  if (!externalUrl) {
    logger.info("keep_alive.skipped", {
      reason: "no_external_url_configured"
    });
    return;
  }

  const pingUrl = `${externalUrl.replace(/\/$/, "")}/api/health`;
  const intervalMs = 10 * 60 * 1000; // Ping every 10 minutes (Render Free sleeps after 15 mins)

  logger.info("keep_alive.started", {
    pingUrl,
    intervalMs
  });

  // Perform a self-ping every 10 minutes to reset Render Free's inactivity timer
  keepAliveInterval = setInterval(async () => {
    try {
      const response = await fetch(pingUrl);
      logger.info("keep_alive.ping_success", {
        status: response.status,
        url: pingUrl
      });
    } catch (error) {
      logger.error("keep_alive.ping_failed", {
        error: error.message,
        url: pingUrl
      });
    }
  }, intervalMs);
}

export function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    logger.info("keep_alive.stopped");
  }
}
