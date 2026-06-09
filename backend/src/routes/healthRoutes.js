import { Router } from "express";
import {
  getHealth,
  getLiveStability,
  getDebugSignals,
  triggerTelegramTestAlert,
  triggerTestSignal
} from "../controllers/healthController.js";

// routes define API URLs and connect them to controller functions.
const router = Router();

router.get("/", getHealth);
router.get("/live-stability", getLiveStability);
router.get("/debug-signals", getDebugSignals);
router.post("/test-telegram-alert", triggerTelegramTestAlert);
router.post("/test-signal", triggerTestSignal);

export default router;
