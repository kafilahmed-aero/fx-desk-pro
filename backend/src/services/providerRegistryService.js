import { logger } from "../utils/logger.js";

const DEFAULT_COOLDOWN_MS = 300000; // 5 minutes default
const MAX_FAILURES = 3;

// Default configuration driven list
const INITIAL_PROVIDERS_CONFIG = [
  { id: "binance", priority: 1, enabled: true, cooldownMs: DEFAULT_COOLDOWN_MS, maxFailures: MAX_FAILURES },
  { id: "yahoo", priority: 2, enabled: true, cooldownMs: DEFAULT_COOLDOWN_MS, maxFailures: MAX_FAILURES }
];

let providers = [];
const stats = new Map(); // providerId -> stats details

/**
 * Initializes/resets the registry stats map
 */
export function resetRegistry(configList = INITIAL_PROVIDERS_CONFIG) {
  providers = JSON.parse(JSON.stringify(configList));
  stats.clear();

  for (const provider of providers) {
    stats.set(provider.id, {
      providerId: provider.id,
      priority: provider.priority,
      enabled: provider.enabled,
      status: "HEALTHY",
      consecutiveFailures: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      cooldownUntil: null,
      lastFailure: null,
      lastSuccess: null
    });
  }

  logger.info("provider_registry.reset", { count: providers.length });
}

// Initial auto-boot setup
resetRegistry();

/**
 * Checks cooldown recovery state for a provider
 */
function checkCooldownRecoveryForStats(stat, now = Date.now()) {
  if (stat.status === "COOLDOWN" && stat.cooldownUntil && now >= stat.cooldownUntil) {
    stat.status = "HEALTHY";
    stat.consecutiveFailures = 0;
    stat.cooldownUntil = null;
    logger.info("provider_registry.recovered", { providerId: stat.providerId });
  }
}

/**
 * Returns the best available provider from the list of candidates
 * @param {Array<string>} candidateIds - Candidate provider IDs to pick from
 * @param {number} now - Optional timestamp for testing
 * @returns {Object|null} Selected provider config or null
 */
export function getBestProvider(candidateIds, now = Date.now()) {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    return null;
  }

  // 1. Recover cooled-down candidates first
  for (const id of candidateIds) {
    const stat = stats.get(id);
    if (stat) {
      checkCooldownRecoveryForStats(stat, now);
    }
  }

  // 2. Select active candidate providers
  const activeCandidates = providers
    .filter((p) => p.enabled && candidateIds.includes(p.id))
    .map((p) => {
      const stat = stats.get(p.id);
      return {
        ...p,
        status: stat ? stat.status : "HEALTHY"
      };
    })
    .filter((p) => p.status !== "COOLDOWN");

  if (activeCandidates.length === 0) {
    return null;
  }

  // 3. Sort by priority asc, then id alphabetically (deterministic fallback)
  activeCandidates.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.id.localeCompare(b.id);
  });

  return activeCandidates[0];
}

/**
 * Reports success for a provider
 * @param {string} providerId - Provider ID
 * @param {number} now - Optional timestamp
 */
export function reportSuccess(providerId, now = Date.now()) {
  const stat = stats.get(providerId);
  if (!stat) return;

  stat.totalSuccesses++;
  stat.consecutiveFailures = 0;
  stat.status = "HEALTHY";
  stat.lastSuccess = new Date(now).toISOString();
}

/**
 * Reports failure for a provider
 * @param {string} providerId - Provider ID
 * @param {number} now - Optional timestamp
 */
export function reportFailure(providerId, now = Date.now()) {
  const stat = stats.get(providerId);
  if (!stat) return;

  const configItem = providers.find((p) => p.id === providerId) || {};
  const maxLimit = configItem.maxFailures || MAX_FAILURES;
  const cooldownPeriod = configItem.cooldownMs || DEFAULT_COOLDOWN_MS;

  stat.totalFailures++;
  stat.consecutiveFailures++;
  stat.lastFailure = new Date(now).toISOString();

  if (stat.consecutiveFailures >= maxLimit) {
    stat.status = "COOLDOWN";
    stat.cooldownUntil = now + cooldownPeriod;
    logger.warn("provider_registry.cooldown_triggered", {
      providerId,
      failures: stat.consecutiveFailures,
      cooldownUntil: new Date(stat.cooldownUntil).toISOString()
    });
  } else {
    stat.status = "DEGRADED";
  }
}

/**
 * Returns read-only provider diagnostics
 * @returns {Array<Object>} List of provider statistics
 */
export function getDiagnostics() {
  const list = [];
  for (const stat of stats.values()) {
    list.push(Object.freeze({
      providerId: stat.providerId,
      priority: stat.priority,
      enabled: stat.enabled,
      state: stat.status,
      consecutiveFailures: stat.consecutiveFailures,
      totalFailures: stat.totalFailures,
      totalSuccesses: stat.totalSuccesses,
      cooldownUntil: stat.cooldownUntil ? new Date(stat.cooldownUntil).toISOString() : null,
      lastFailure: stat.lastFailure,
      lastSuccess: stat.lastSuccess
    }));
  }
  return list;
}
