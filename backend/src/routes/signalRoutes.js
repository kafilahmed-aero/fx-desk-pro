import { Router } from "express";
import { getSignalsController } from "../controllers/signalController.js";

const router = Router();

router.get("/", getSignalsController);

export default router;
