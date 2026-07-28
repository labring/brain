const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

/**
 * One code-owned timeout policy for deployment execution. Phase budgets are
 * ceilings inside the overall run deadline; callers always clamp child work
 * to both the phase deadline and the remaining task time.
 */
export const DEPLOY_TIMEOUT_POLICY = {
  applyMs: 5 * MINUTE_MS,
  devboxReadyMs: 5 * MINUTE_MS,
  finalizeMs: 2 * MINUTE_MS,
  gatewayCleanupMs: 5 * SECOND_MS,
  gatewayInitialTurnMs: 35 * MINUTE_MS,
  gatewayPollMs: 2500,
  gatewayRepairTurnMs: 10 * MINUTE_MS,
  gatewayRequestMs: 60 * SECOND_MS,
  gatewayStartupMs: 60 * SECOND_MS,
  generateMs: 45 * MINUTE_MS,
  imageBuildSeconds: 30 * 60,
  outputPollMs: 15 * SECOND_MS,
  outputReadMs: 30 * SECOND_MS,
  overallMs: 70 * MINUTE_MS,
  prepareMs: 8 * MINUTE_MS,
  readinessMs: 10 * MINUTE_MS,
  repositoryCloneMs: 5 * MINUTE_MS,
  skillInstallMs: 3 * MINUTE_MS,
} as const;

function assertTimeoutPolicy(): void {
  const policy = DEPLOY_TIMEOUT_POLICY;
  const phaseTotalMs =
    policy.prepareMs +
    policy.generateMs +
    policy.applyMs +
    policy.readinessMs +
    policy.finalizeMs;
  if (phaseTotalMs !== policy.overallMs) {
    throw new Error("Deployment phase budgets must equal the overall timeout.");
  }
  if (
    policy.gatewayInitialTurnMs + policy.gatewayRepairTurnMs >
    policy.generateMs
  ) {
    throw new Error("Gateway turn budgets exceed the generation budget.");
  }
  if (policy.gatewayCleanupMs > policy.gatewayRequestMs) {
    throw new Error("Gateway cleanup timeout exceeds the request timeout.");
  }
  if (policy.imageBuildSeconds * SECOND_MS > policy.generateMs) {
    throw new Error("Image build timeout exceeds the generation budget.");
  }
}

assertTimeoutPolicy();

export function deployTaskDeadlineAt(input: {
  leaseClaimedAt: Date | null;
  nowMs?: number;
}): number {
  const nowMs = input.nowMs ?? Date.now();
  const startedAtMs = input.leaseClaimedAt?.getTime();
  return (
    (startedAtMs != null && Number.isFinite(startedAtMs)
      ? startedAtMs
      : nowMs) + DEPLOY_TIMEOUT_POLICY.overallMs
  );
}

export function deploymentPhaseDeadlineAt(input: {
  budgetMs: number;
  nowMs?: number;
  reserveMs?: number;
  taskDeadlineAtMs: number;
}): number {
  const nowMs = input.nowMs ?? Date.now();
  return Math.min(
    nowMs + input.budgetMs,
    input.taskDeadlineAtMs - (input.reserveMs ?? 0)
  );
}

export function remainingDeploymentTimeoutMs(input: {
  capMs?: number;
  deadlineAtMs: number;
  nowMs?: number;
}): number {
  const remainingMs = Math.max(
    0,
    input.deadlineAtMs - (input.nowMs ?? Date.now())
  );
  return input.capMs == null ? remainingMs : Math.min(remainingMs, input.capMs);
}

export function remainingDeploymentTimeoutSeconds(input: {
  capMs?: number;
  deadlineAtMs: number;
  nowMs?: number;
}): number {
  return Math.ceil(remainingDeploymentTimeoutMs(input) / SECOND_MS);
}
