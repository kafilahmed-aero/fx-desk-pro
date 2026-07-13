import { logger } from "../utils/logger.js";

const DEFAULT_COOLDOWN_MS = 600000; // 10 minutes default
const MAX_FAILURES = 3;

const INITIAL_AI_PROVIDERS_CONFIG = [
  { id: "gemini", priority: 1, enabled: true, cooldownMs: DEFAULT_COOLDOWN_MS, maxFailures: MAX_FAILURES },
  { id: "mock", priority: 2, enabled: true, cooldownMs: DEFAULT_COOLDOWN_MS, maxFailures: MAX_FAILURES }
];

let configs = new Map(); // providerId -> config settings
let stats = new Map();   // providerId -> state stats

/**
 * Deep freezes an object recursively to guarantee immutability.
 * @param {Object} obj - Target object
 * @returns {Object} Frozen object
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  Object.keys(obj).forEach((key) => {
    deepFreeze(obj[key]);
  });
  return obj;
}

/**
 * Initializes or resets the registry config and status states.
 * @param {Array<Object>} initialConfigs - Initial provider settings array
 */
export function initializeRegistry(initialConfigs = INITIAL_AI_PROVIDERS_CONFIG) {
  configs.clear();
  stats.clear();

  for (const item of initialConfigs) {
    const id = String(item.id).toLowerCase().trim();
    configs.set(id, {
      id,
      priority: typeof item.priority === "number" ? item.priority : 1,
      enabled: item.enabled !== false,
      cooldownMs: typeof item.cooldownMs === "number" ? item.cooldownMs : DEFAULT_COOLDOWN_MS,
      maxFailures: typeof item.maxFailures === "number" ? item.maxFailures : MAX_FAILURES
    });

    stats.set(id, {
      providerId: id,
      status: "HEALTHY",
      consecutiveFailures: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      cooldownUntil: null,
      lastFailure: null,
      lastSuccess: null
    });
  }

  logger.info("ai_provider_manager.initialized", { count: configs.size });
}

// Auto-initialize on load
initializeRegistry();

/**
 * Updates provider config settings at runtime without requiring application restart.
 * @param {string} providerId - Provider ID key
 * @param {Object} updates - Config overrides (e.g. { enabled: false, priority: 3 })
 */
export function setProviderConfig(providerId, updates = {}) {
  const id = String(providerId).toLowerCase().trim();
  const existing = configs.get(id);
  if (!existing) {
    logger.warn("ai_provider_manager.set_config_skipped_not_found", { providerId: id });
    return;
  }

  if (updates.priority !== undefined) {
    existing.priority = Number(updates.priority);
  }
  if (updates.enabled !== undefined) {
    existing.enabled = Boolean(updates.enabled);
  }
  if (updates.cooldownMs !== undefined) {
    existing.cooldownMs = Number(updates.cooldownMs);
  }
  if (updates.maxFailures !== undefined) {
    existing.maxFailures = Number(updates.maxFailures);
  }

  logger.info("ai_provider_manager.config_updated", { providerId: id, config: existing });
}

/**
 * Checks cooldown recovery state for a provider.
 */
function checkCooldownRecovery(stat, cooldownMs, now = Date.now()) {
  if (stat.status === "COOLDOWN" && stat.cooldownUntil && now >= stat.cooldownUntil) {
    stat.status = "HEALTHY";
    stat.consecutiveFailures = 0;
    stat.cooldownUntil = null;
    logger.info("ai_provider_manager.recovered", { providerId: stat.providerId });
  }
}

/**
 * Retrieves candidates sorted by priority that are enabled and not cooling down.
 * @param {Array<string>} candidateIds - Candidate provider IDs to pick from
 * @param {number} now - Current timestamp reference
 * @returns {Array<Object>} Sorted configuration list
 */
export function getPrioritizedProviders(candidateIds = [], now = Date.now()) {
  const normCandidates = candidateIds.map(id => String(id).toLowerCase().trim());
  const keysToEvaluate = normCandidates.length > 0 ? normCandidates : Array.from(configs.keys());

  // 1. Recover cooled down candidates
  for (const id of keysToEvaluate) {
    const stat = stats.get(id);
    const configItem = configs.get(id);
    if (stat && configItem) {
      checkCooldownRecovery(stat, configItem.cooldownMs, now);
    }
  }

  // 2. Select enabled, non-cooldown candidates
  const activeList = [];
  for (const id of keysToEvaluate) {
    const configItem = configs.get(id);
    const stat = stats.get(id);
    if (configItem && configItem.enabled && stat && stat.status !== "COOLDOWN") {
      activeList.push({
        ...configItem,
        status: stat.status
      });
    }
  }

  // 3. Sort by priority asc, then id alphabetically
  activeList.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.id.localeCompare(b.id);
  });

  return activeList;
}

/**
 * Reports a successful generation call.
 * @param {string} providerId - Provider ID key
 * @param {number} now - Timestamp reference
 */
export function reportSuccess(providerId, now = Date.now()) {
  const id = String(providerId).toLowerCase().trim();
  const stat = stats.get(id);
  if (!stat) return;

  stat.totalSuccesses++;
  stat.consecutiveFailures = 0;
  stat.status = "HEALTHY";
  stat.lastSuccess = new Date(now).toISOString();
}

/**
 * Reports a failed generation call.
 * @param {string} providerId - Provider ID key
 * @param {number} now - Timestamp reference
 */
export function reportFailure(providerId, now = Date.now()) {
  const id = String(providerId).toLowerCase().trim();
  const stat = stats.get(id);
  const configItem = configs.get(id);
  if (!stat || !configItem) return;

  stat.totalFailures++;
  stat.consecutiveFailures++;
  stat.lastFailure = new Date(now).toISOString();

  if (stat.consecutiveFailures >= configItem.maxFailures) {
    stat.status = "COOLDOWN";
    stat.cooldownUntil = now + configItem.cooldownMs;
    logger.warn("ai_provider_manager.cooldown_triggered", {
      providerId: id,
      failures: stat.consecutiveFailures,
      cooldownUntil: new Date(stat.cooldownUntil).toISOString()
    });
  } else {
    stat.status = "DEGRADED";
  }
}

/**
 * Generates an immutable, recursively frozen diagnostics snapshot.
 * @returns {Array<Object>} Locked stats list
 */
export function getDiagnostics() {
  const diagnosticsList = [];
  for (const [id, stat] of stats.entries()) {
    const configItem = configs.get(id) || {};
    diagnosticsList.push({
      providerId: stat.providerId,
      priority: configItem.priority,
      enabled: configItem.enabled,
      status: stat.status,
      consecutiveFailures: stat.consecutiveFailures,
      totalFailures: stat.totalFailures,
      totalSuccesses: stat.totalSuccesses,
      cooldownUntil: stat.cooldownUntil ? new Date(stat.cooldownUntil).toISOString() : null,
      lastFailure: stat.lastFailure,
      lastSuccess: stat.lastSuccess
    });
  }
  return deepFreeze(diagnosticsList);
}
