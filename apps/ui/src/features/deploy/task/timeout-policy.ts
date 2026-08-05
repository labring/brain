const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

const COMMON_DEPLOY_TIMEOUT_POLICY = {
  devboxReadyMs: 5 * MINUTE_MS,
  finalizeMs: 2 * MINUTE_MS,
  gatewayCleanupMs: 5 * SECOND_MS,
  gatewayPollMs: 2500,
  gatewayRequestMs: 60 * SECOND_MS,
  gatewayStartupMs: 60 * SECOND_MS,
  imageBuildSeconds: 30 * 60,
  outputPollMs: 15 * SECOND_MS,
  outputReadMs: 30 * SECOND_MS,
  overallMs: 70 * MINUTE_MS,
  prepareMs: 8 * MINUTE_MS,
  repositoryCloneMs: 5 * MINUTE_MS,
  skillInstallMs: 3 * MINUTE_MS,
} as const;

/**
 * Legacy Brain-owned execution policy. Keep these budgets stable while agent
 * execution is feature-gated so disabling the flag restores existing behavior.
 */
export const DEPLOY_TIMEOUT_POLICY = {
  ...COMMON_DEPLOY_TIMEOUT_POLICY,
  applyMs: 5 * MINUTE_MS,
  gatewayInitialTurnMs: 35 * MINUTE_MS,
  gatewayRepairTurnMs: 10 * MINUTE_MS,
  generateMs: 45 * MINUTE_MS,
  readinessMs: 10 * MINUTE_MS,
} as const;

/** Agent-owned generation, repair, and Brain verification policy. */
export const AGENT_DEPLOY_TIMEOUT_POLICY = {
  ...COMMON_DEPLOY_TIMEOUT_POLICY,
  gatewayInitialTurnMs: 30 * MINUTE_MS,
  maxRepairTurns: 2,
  operationalSlackMs: 6 * MINUTE_MS,
  repairMs: 14 * MINUTE_MS,
  repairTurnMs: 7 * MINUTE_MS,
  generateMs: 30 * MINUTE_MS,
  verifyMs: 10 * MINUTE_MS,
} as const;

function assertTimeoutPolicy(): void {
  const legacy = DEPLOY_TIMEOUT_POLICY;
  const legacyPhaseTotalMs =
    legacy.prepareMs +
    legacy.generateMs +
    legacy.applyMs +
    legacy.readinessMs +
    legacy.finalizeMs;
  if (legacyPhaseTotalMs !== legacy.overallMs) {
    throw new Error(
      "Legacy deployment phase budgets must equal the overall timeout."
    );
  }
  if (
    legacy.gatewayInitialTurnMs + legacy.gatewayRepairTurnMs >
    legacy.generateMs
  ) {
    throw new Error("Legacy Gateway turns exceed the generation budget.");
  }

  const agent = AGENT_DEPLOY_TIMEOUT_POLICY;
  const agentPhaseTotalMs =
    agent.prepareMs +
    agent.generateMs +
    agent.repairMs +
    agent.verifyMs +
    agent.finalizeMs +
    agent.operationalSlackMs;
  if (agentPhaseTotalMs !== agent.overallMs) {
    throw new Error(
      "Agent deployment phase budgets must equal the overall timeout."
    );
  }
  if (agent.gatewayInitialTurnMs > agent.generateMs) {
    throw new Error(
      "Agent Gateway initial turn exceeds the generation budget."
    );
  }
  if (agent.repairTurnMs * agent.maxRepairTurns > agent.repairMs) {
    throw new Error("Gateway repair turns exceed the repair budget.");
  }
  if (legacy.gatewayCleanupMs > legacy.gatewayRequestMs) {
    throw new Error("Gateway cleanup timeout exceeds the request timeout.");
  }
  if (
    legacy.imageBuildSeconds * SECOND_MS > legacy.generateMs ||
    agent.imageBuildSeconds * SECOND_MS > agent.generateMs
  ) {
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
