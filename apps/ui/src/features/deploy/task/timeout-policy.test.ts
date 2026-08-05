import { describe, expect, it } from "bun:test";

import {
  AGENT_DEPLOY_TIMEOUT_POLICY,
  DEPLOY_TIMEOUT_POLICY,
  deploymentPhaseDeadlineAt,
  deployTaskDeadlineAt,
  remainingDeploymentTimeoutMs,
  remainingDeploymentTimeoutSeconds,
} from "./timeout-policy";

const MINUTE_MS = 60_000;

describe("deployment timeout policy", () => {
  it("preserves the legacy Brain-owned 70 minute execution budget", () => {
    expect(
      DEPLOY_TIMEOUT_POLICY.prepareMs +
        DEPLOY_TIMEOUT_POLICY.generateMs +
        DEPLOY_TIMEOUT_POLICY.applyMs +
        DEPLOY_TIMEOUT_POLICY.readinessMs +
        DEPLOY_TIMEOUT_POLICY.finalizeMs
    ).toBe(70 * MINUTE_MS);
    expect(DEPLOY_TIMEOUT_POLICY.overallMs).toBe(70 * MINUTE_MS);
    expect(DEPLOY_TIMEOUT_POLICY.gatewayCleanupMs).toBe(5000);
    expect(DEPLOY_TIMEOUT_POLICY.generateMs).toBe(45 * MINUTE_MS);
    expect(DEPLOY_TIMEOUT_POLICY.gatewayInitialTurnMs).toBe(35 * MINUTE_MS);
    expect(DEPLOY_TIMEOUT_POLICY.gatewayRepairTurnMs).toBe(10 * MINUTE_MS);
  });

  it("keeps Agent generation, repair, verification, and slack separate", () => {
    expect(
      AGENT_DEPLOY_TIMEOUT_POLICY.prepareMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.generateMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.repairMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.verifyMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.finalizeMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.operationalSlackMs
    ).toBe(70 * MINUTE_MS);
    expect(AGENT_DEPLOY_TIMEOUT_POLICY.generateMs).toBe(30 * MINUTE_MS);
    expect(AGENT_DEPLOY_TIMEOUT_POLICY.gatewayInitialTurnMs).toBe(
      30 * MINUTE_MS
    );
    expect(AGENT_DEPLOY_TIMEOUT_POLICY.repairMs).toBe(14 * MINUTE_MS);
    expect(AGENT_DEPLOY_TIMEOUT_POLICY.repairTurnMs).toBe(7 * MINUTE_MS);
    expect(AGENT_DEPLOY_TIMEOUT_POLICY.maxRepairTurns).toBe(2);
    expect(AGENT_DEPLOY_TIMEOUT_POLICY.verifyMs).toBe(10 * MINUTE_MS);
    expect(AGENT_DEPLOY_TIMEOUT_POLICY.finalizeMs).toBe(2 * MINUTE_MS);
    expect(AGENT_DEPLOY_TIMEOUT_POLICY.operationalSlackMs).toBe(6 * MINUTE_MS);
  });

  it("derives the task deadline from the run start", () => {
    expect(
      deployTaskDeadlineAt({
        leaseClaimedAt: new Date("2026-07-27T00:00:00.000Z"),
        nowMs: Date.parse("2026-07-27T00:01:00.000Z"),
      })
    ).toBe(Date.parse("2026-07-27T01:10:00.000Z"));
  });

  it("clamps a phase budget to the task reserve", () => {
    expect(
      deploymentPhaseDeadlineAt({
        budgetMs: 45 * MINUTE_MS,
        nowMs: 10 * MINUTE_MS,
        reserveMs: 17 * MINUTE_MS,
        taskDeadlineAtMs: 70 * MINUTE_MS,
      })
    ).toBe(53 * MINUTE_MS);
  });

  it("clamps operation timeouts and rounds exec seconds up", () => {
    expect(
      remainingDeploymentTimeoutMs({
        capMs: 60_000,
        deadlineAtMs: 15_500,
        nowMs: 10_000,
      })
    ).toBe(5500);
    expect(
      remainingDeploymentTimeoutSeconds({
        deadlineAtMs: 15_500,
        nowMs: 10_000,
      })
    ).toBe(6);
  });
});
