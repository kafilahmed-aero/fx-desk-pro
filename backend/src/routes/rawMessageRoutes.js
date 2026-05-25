import { Router } from "express";
import { getRawMessagesController } from "../controllers/rawMessageController.js";

const router = Router();

router.get("/", getRawMessagesController);

export default router;
