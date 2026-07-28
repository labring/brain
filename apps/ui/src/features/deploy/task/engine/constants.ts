import { DEPLOY_TIMEOUT_POLICY } from "../timeout-policy";

/**
 * Engine cadences (ADR 0037). Tuning, not contract — tests shrink them; the
 * transition table and fencing rules are the contract.
 */
export interface DeployTaskEngineCadence {
  /** Forced `cancelled` when a cancel request goes unacknowledged this long. */
  cancelAckDeadlineMs: number;
  /** Devbox pauses attempted per reaper sweep. */
  devboxPauseBatchSize: number;
  /** Lease lifetime granted by a claim or renewal. */
  leaseDurationMs: number;
  /** Fenced timer interval renewing held leases (also polls cancel intent). */
  leaseRenewIntervalMs: number;
  /** A lease held longer than this fails with a timeout reason. */
  maxActiveRunMs: number;
  /** Terminal tasks purged per reaper sweep. */
  purgeBatchSize: number;
  /** A row still `queued` past this deadline failed to start (crash gap). */
  queuedStartDeadlineMs: number;
  /** Reaper sweep interval per process. */
  reaperIntervalMs: number;
  /** Terminal tasks are purged after this window. */
  retentionMs: number;
}

export const DEPLOY_TASK_ENGINE_CADENCE: DeployTaskEngineCadence = {
  cancelAckDeadlineMs: 90_000,
  devboxPauseBatchSize: 10,
  leaseDurationMs: 60_000,
  leaseRenewIntervalMs: 20_000,
  maxActiveRunMs: DEPLOY_TIMEOUT_POLICY.overallMs,
  purgeBatchSize: 20,
  queuedStartDeadlineMs: 120_000,
  reaperIntervalMs: 30_000,
  retentionMs: 30 * 24 * 60 * 60_000,
};
