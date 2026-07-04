import { Router } from "express";
import {
  getXauusdRecommendationController,
  getLatestXauusdRecommendationController
} from "../controllers/aiController.js";

const router = Router();

router.get("/xauusd/recommendation", getXauusdRecommendationController);
router.get("/xauusd/latest", getLatestXauusdRecommendationController);

export default router;
