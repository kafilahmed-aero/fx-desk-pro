import { Router } from "express";
import { getOutcomeSummaryController } from "../controllers/outcomeAnalyticsController.js";

const router = Router();

router.get("/", getOutcomeSummaryController);

export default router;
