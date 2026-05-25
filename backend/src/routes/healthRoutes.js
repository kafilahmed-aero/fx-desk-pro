import { Router } from "express";
import { getHealth } from "../controllers/healthController.js";

// routes define API URLs and connect them to controller functions.
const router = Router();

router.get("/", getHealth);

export default router;
