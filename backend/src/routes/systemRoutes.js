import { Router } from "express";
import {
  getSystemHealthController,
  getTelegramHealthController,
  getParserHealthController,
  getMetricsController
} from "../controllers/systemController.js";

const router = Router();

router.get("/health", getSystemHealthController);
router.get("/telegram", getTelegramHealthController);
router.get("/parser", getParserHealthController);
router.get("/metrics", getMetricsController);

export default router;
