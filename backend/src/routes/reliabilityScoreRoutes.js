import { Router } from "express";
import { getReliabilityScoresController } from "../controllers/reliabilityScoreController.js";

const router = Router();

router.get("/", getReliabilityScoresController);

export default router;
