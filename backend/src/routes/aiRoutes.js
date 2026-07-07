import { Router } from "express";
import {
  getXauusdRecommendationController,
  getLatestXauusdRecommendationController,
  getAiAnalyticsController
} from "../controllers/aiController.js";

const router = Router();

router.get("/xauusd/recommendation", getXauusdRecommendationController);
router.get("/xauusd/latest", getLatestXauusdRecommendationController);
router.get("/analytics", getAiAnalyticsController);

export default router;
