import { Router } from "express";
import { getChannelPerformanceController } from "../controllers/channelPerformanceController.js";

const router = Router();

router.get("/", getChannelPerformanceController);

export default router;
