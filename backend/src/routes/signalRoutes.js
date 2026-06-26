import { Router } from "express";
import { getParsedSignalsController } from "../controllers/parsedSignalController.js";

const router = Router();

router.get("/", getParsedSignalsController);

export default router;
