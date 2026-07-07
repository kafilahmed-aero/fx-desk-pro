import mongoose from "mongoose";
import { AutomationSettings } from "../models/automationSettingsModel.js";

let localSettings = {
  automationEnabled: false,
  maximumOpenTrades: 2,
  duplicateTradesPerRecommendation: 1,
  tpMode: "LOW_RISK",
  fixedLotSize: 0.1
};

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

export function getSettingsSync() {
  return localSettings;
}

export async function getSettings() {
  if (isMongoConnected()) {
    try {
      let settings = await AutomationSettings.findOne();
      if (!settings) {
        settings = await AutomationSettings.create(localSettings);
      }
      const obj = settings.toObject();
      localSettings = { ...localSettings, ...obj };
      return obj;
    } catch (err) {
      return localSettings;
    }
  }
  return localSettings;
}

export async function updateSettings(newSettings) {
  const cleanSettings = {
    automationEnabled: typeof newSettings.automationEnabled === "boolean" ? newSettings.automationEnabled : localSettings.automationEnabled,
    maximumOpenTrades: typeof newSettings.maximumOpenTrades === "number" ? newSettings.maximumOpenTrades : localSettings.maximumOpenTrades,
    duplicateTradesPerRecommendation: typeof newSettings.duplicateTradesPerRecommendation === "number" ? newSettings.duplicateTradesPerRecommendation : localSettings.duplicateTradesPerRecommendation,
    tpMode: ["LOW_RISK", "MODERATE", "HIGH_RISK"].includes(newSettings.tpMode) ? newSettings.tpMode : localSettings.tpMode,
    fixedLotSize: typeof newSettings.fixedLotSize === "number" ? newSettings.fixedLotSize : localSettings.fixedLotSize
  };

  // Sync back to localSettings in case DB goes down later
  localSettings = { ...localSettings, ...cleanSettings };

  if (isMongoConnected()) {
    try {
      let settings = await AutomationSettings.findOne();
      if (!settings) {
        await AutomationSettings.create(localSettings);
      } else {
        await AutomationSettings.updateOne({}, cleanSettings);
      }
    } catch (err) {
      // ignore
    }
  }
  return localSettings;
}
