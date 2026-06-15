import { Router } from "express";
import { getDatasetMonitoringReportController } from "../controllers/monitoringController.js";

const router = Router();

router.get("/dataset", getDatasetMonitoringReportController);

export default router;
