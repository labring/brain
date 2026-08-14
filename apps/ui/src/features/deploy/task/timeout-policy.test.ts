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
  it("keeps shared task and direct apply budgets stable", () => {
    expect(DEPLOY_TIMEOUT_POLICY.overallMs).toBe(70 * MINUTE_MS);
    expect(DEPLOY_TIMEOUT_POLICY.gatewayCleanupMs).toBe(5000);
    expect(DEPLOY_TIMEOUT_POLICY.prepareMs).toBe(8 * MINUTE_MS);
    expect(DEPLOY_TIMEOUT_POLICY.applyMs).toBe(5 * MINUTE_MS);
    expect(DEPLOY_TIMEOUT_POLICY.readinessMs).toBe(10 * MINUTE_MS);
    expect(DEPLOY_TIMEOUT_POLICY.finalizeMs).toBe(2 * MINUTE_MS);
  });

  it("keeps Agent execution, verification, and slack within the overall timeout", () => {
    expect(
      AGENT_DEPLOY_TIMEOUT_POLICY.prepareMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.agentExecutionMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.verifyMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.finalizeMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.operationalSlackMs
    ).toBe(70 * MINUTE_MS);
    expect(AGENT_DEPLOY_TIMEOUT_POLICY.agentExecutionMs).toBe(44 * MINUTE_MS);
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
