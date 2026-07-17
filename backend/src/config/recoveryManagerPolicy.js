/**
 * Policy configurations for the Phoenix Recovery Manager.
 */
export const RECOVERY_MANAGER_POLICY = {
  policyVersion: "1.0",
  reconnectTimeoutMs: 5000,
  maxRecoveryAttempts: 5,
  reconciliationIntervalMs: 10000,
  syncTimeoutMs: 15000
};
