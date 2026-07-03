import { Router } from "express";
import { getHealth, getLiveStability, getDebugSignals } from "../controllers/healthController.js";

// routes define API URLs and connect them to controller functions.
const router = Router();

router.get("/", getHealth);
router.get("/live-stability", getLiveStability);
router.get("/debug-signals", getDebugSignals);

export default router;
