import { getDatasetMonitoringReport } from "../services/dataCollectionMonitoringService.js";
import { logger } from "../utils/logger.js";

/**
 * Controller to fetch dataset monitoring statistics for developers and audits
 */
export async function getDatasetMonitoringReportController(req, res) {
  try {
    const report = await getDatasetMonitoringReport();
    return res.status(200).json(report);
  } catch (error) {
    logger.error("api.get_dataset_monitoring_failed", { error: error.message });
    return res.status(500).json({ error: "Failed to retrieve dataset monitoring stats" });
  }
}
