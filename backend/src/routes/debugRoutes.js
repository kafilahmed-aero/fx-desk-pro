import { Router } from "express";
import { emitDebugSmartAlertController } from "../controllers/debugController.js";

const router = Router();

router.get("/emit-smart-alert", emitDebugSmartAlertController);

export default router;
