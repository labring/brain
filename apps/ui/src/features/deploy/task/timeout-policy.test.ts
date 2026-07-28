import { describe, expect, it } from "bun:test";

import {
  DEPLOY_TIMEOUT_POLICY,
  deploymentPhaseDeadlineAt,
  deployTaskDeadlineAt,
  remainingDeploymentTimeoutMs,
  remainingDeploymentTimeoutSeconds,
} from "./timeout-policy";

const MINUTE_MS = 60_000;

describe("deployment timeout policy", () => {
  it("allocates the full 70 minute execution budget", () => {
    expect(
      DEPLOY_TIMEOUT_POLICY.prepareMs +
        DEPLOY_TIMEOUT_POLICY.generateMs +
        DEPLOY_TIMEOUT_POLICY.applyMs +
        DEPLOY_TIMEOUT_POLICY.readinessMs +
        DEPLOY_TIMEOUT_POLICY.finalizeMs
    ).toBe(70 * MINUTE_MS);
    expect(DEPLOY_TIMEOUT_POLICY.overallMs).toBe(70 * MINUTE_MS);
    expect(DEPLOY_TIMEOUT_POLICY.gatewayCleanupMs).toBe(5000);
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
