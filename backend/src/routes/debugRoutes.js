import { Router } from "express";
import { storeRawMessage } from "../services/rawMessageStore.js";
import { enqueueRawMessageProcessing } from "../services/messageProcessingQueue.js";
import { logger } from "../utils/logger.js";

const router = Router();

router.post("/test-signal", async (req, res) => {
  try {
    console.log("[NOTIFICATION TRACE] Endpoint /api/debug/test-signal called");
    const rawMessage = {
      channel: "debug_channel_123",
      channelTitle: "Debug Ingest Channel",
      messageId: 10000 + Math.floor(Math.random() * 90000),
      text: "BUY EURUSD ENTRY 1.0850 TP 1.0900 SL 1.0800",
      hasText: true,
      hasMedia: false,
      mediaType: null,
      textLength: 43,
      timestamp: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    };

    const storeResult = await storeRawMessage(rawMessage);
    if (!storeResult.stored) {
      return res.status(400).json({ error: "Failed to store raw message, duplicate?", storeResult });
    }

    console.log("[NOTIFICATION TRACE] Stored raw message, enqueuing processing");
    enqueueRawMessageProcessing(rawMessage);

    return res.json({ success: true, message: "Signal enqueued and sent to pipeline", rawMessage });
  } catch (err) {
    logger.error("debug.test_signal_failed", { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

export default router;
