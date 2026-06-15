import { Router } from "express";
import { getPairPerformanceController } from "../controllers/pairPerformanceController.js";

const router = Router();

router.get("/", getPairPerformanceController);

export default router;
