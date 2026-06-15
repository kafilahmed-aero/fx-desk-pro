import { getOutcomes } from "./signalOutcomeStore.js";

/**
 * Generates a backend report summarizing historical dataset collection stats.
 * @returns {Promise<Object>} The dataset collection monitoring details.
 */
export async function getDatasetMonitoringReport() {
  const outcomes = await getOutcomes(10000);

  const totalSignalsTracked = outcomes.length;
  let activeSignals = 0;
  let pendingSignals = 0;
  let fullTpOutcomes = 0;
  let partialTpOutcomes = 0;
  let slOutcomes = 0;
  let expiredOutcomes = 0;
  let cancelledOutcomes = 0;

  const completedDates = [];

  outcomes.forEach((o) => {
    const status = o.status;
    const date = o.outcomeTime ? new Date(o.outcomeTime) : (o.createdAt ? new Date(o.createdAt) : null);

    switch (status) {
      case "PENDING":
        pendingSignals++;
        break;
      case "ACTIVE":
        activeSignals++;
        break;
      case "FULL_TP":
        fullTpOutcomes++;
        if (date) completedDates.push(date);
        break;
      case "PARTIAL_TP":
        partialTpOutcomes++;
        if (date) completedDates.push(date);
        break;
      case "SL_HIT":
        slOutcomes++;
        if (date) completedDates.push(date);
        break;
      case "EXPIRED":
        expiredOutcomes++;
        if (date) completedDates.push(date);
        break;
      case "CANCELLED":
        cancelledOutcomes++;
        if (date) completedDates.push(date);
        break;
    }
  });

  const completedSignals = fullTpOutcomes + partialTpOutcomes + slOutcomes + expiredOutcomes + cancelledOutcomes;

  let earliestOutcomeDate = null;
  let latestOutcomeDate = null;
  let totalDaysOfCoverage = 0;

  if (completedDates.length > 0) {
    const times = completedDates.map((d) => d.getTime());
    earliestOutcomeDate = new Date(Math.min(...times));
    latestOutcomeDate = new Date(Math.max(...times));

    const diffMs = latestOutcomeDate.getTime() - earliestOutcomeDate.getTime();
    totalDaysOfCoverage = Number((diffMs / (1000 * 60 * 60 * 24)).toFixed(2));
  }

  return {
    totalSignalsTracked,
    activeSignals,
    pendingSignals,
    completedSignals,
    fullTpOutcomes,
    partialTpOutcomes,
    slOutcomes,
    expiredOutcomes,
    cancelledOutcomes,
    earliestOutcomeDate: earliestOutcomeDate ? earliestOutcomeDate.toISOString() : null,
    latestOutcomeDate: latestOutcomeDate ? latestOutcomeDate.toISOString() : null,
    totalDaysOfCoverage,
  };
}
