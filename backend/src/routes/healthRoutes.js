import { Router } from "express";
import { getHealth, getLiveStability, getDebugSignals, getReclassificationAudit } from "../controllers/healthController.js";

// routes define API URLs and connect them to controller functions.
const router = Router();

router.get("/", getHealth);
router.get("/live-stability", getLiveStability);
router.get("/debug-signals", getDebugSignals);
router.get("/reclassification-audit", getReclassificationAudit);

export default router;
