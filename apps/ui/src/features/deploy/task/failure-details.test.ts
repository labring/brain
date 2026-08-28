import { describe, expect, it } from "bun:test";

import {
  attachDeployFailureDetails,
  attachedDeployFailureDetails,
  attachedDeployFailureReason,
  deployFailureError,
  deploymentFailureTechnicalDetail,
  publicDeployTaskError,
  publicDeployTaskFailureDetails,
  templateCleanupAllowed,
} from "./failure-details";
import type { DeployTaskFailureReason } from "./schema";

describe("deploy failure details channel", () => {
  it("merges attached details onto the error and reads them back", () => {
    const error = new Error("apply exploded");
    attachDeployFailureDetails(error, { source: "applyDeploymentArtifact" });
    attachDeployFailureDetails(error, { stage: "apply" });
    expect(attachedDeployFailureDetails(error)).toEqual({
      source: "applyDeploymentArtifact",
      stage: "apply",
    });
  });

  it("returns no details for non-Error failures", () => {
    expect(attachedDeployFailureDetails("thrown string")).toEqual({});
    expect(attachedDeployFailureDetails(null)).toEqual({});
  });

  it("reads the attached stable reason", () => {
    const error = attachDeployFailureDetails(new Error("private stderr"), {
      reason: "gateway-upstream-error",
    });
    expect(attachedDeployFailureReason(error)).toBe("gateway-upstream-error");
  });

  it.each([
    [
      "build-runtime-unavailable",
      "The deployment workspace does not expose the required build service. Redeploy; if the problem continues, contact support.",
    ],
    [
      "gateway-not-exposed",
      "The workspace did not expose the deployment analysis service. Redeploy; if the problem continues, contact support.",
    ],
    [
      "deployment-output-missing",
      "Repository analysis finished without a deployable result. Redeploy; if the problem continues, contact support.",
    ],
  ] as const)("creates a terminal-safe %s failure", (reason: DeployTaskFailureReason, message: string) => {
    const error = deployFailureError(reason);

    expect(error.message).toBe(message);
    expect(attachedDeployFailureReason(error)).toBe(reason);
  });
});

describe("public AI failure projection", () => {
  const runner = { kind: "ai", runtimeProvider: "devbox" } as const;

  it("drops raw and arbitrary persisted fields", () => {
    const details = publicDeployTaskFailureDetails({
      details: {
        errorMessage: "Bearer private-token",
        failureMessage: "untrusted persisted copy",
        httpStatus: 503,
        reason: "gateway-upstream-error",
        source: "raw-source",
      },
      runner,
      status: "failed",
    });
    expect(details).toEqual({
      failureMessage:
        "The deployment analysis service returned an error. Redeploy in a few minutes.",
      httpStatus: 503,
      reason: "gateway-upstream-error",
    });
    expect(JSON.stringify(details)).not.toContain("private-token");
    expect(
      publicDeployTaskError({
        details,
        error: "Bearer private-token",
        runner,
        status: "failed",
      })
    ).toBe(
      "The deployment analysis service returned an error. Redeploy in a few minutes."
    );
  });

  it("formats only allowlisted technical detail", () => {
    const detail = deploymentFailureTechnicalDetail({
      details: {
        errorMessage: "Bearer private-token",
        httpStatus: 503,
        reason: "gateway-upstream-error",
      },
      error: "Bearer private-token",
      id: "task-31",
      phase: "plan",
      runner,
      status: "failed",
    });
    expect(detail).toBe(
      "Reason: gateway-upstream-error\nPhase: plan\nHTTP status: 503\nTask ID: task-31"
    );
    expect(detail).not.toContain("private-token");
  });

  it("projects legacy failed rows without a reason as unknown", () => {
    expect(
      publicDeployTaskFailureDetails({
        details: null,
        runner,
        status: "failed",
      })
    ).toEqual({
      failureMessage:
        "Deployment failed for an unknown reason. Copy the Task ID and contact support.",
      reason: "unknown",
    });
  });
});

describe("deterministic runner failure detail", () => {
  it("preserves the scrubbed provider error for direct runners", () => {
    expect(
      deploymentFailureTechnicalDetail({
        details: null,
        error: "provider rejected [REDACTED]",
        id: "task-direct",
        phase: "apply",
        runner: { kind: "direct" },
        status: "failed",
      })
    ).toBe("provider rejected [REDACTED]");
  });
});

describe("template cleanup eligibility (ADR 0037/0038)", () => {
  it("allows cleanup only for apply-stage failures with a freshly allocated identity", () => {
    const error = attachDeployFailureDetails(new Error("provider 500"), {
      stage: "apply",
    });
    expect(
      templateCleanupAllowed(error, { identityFreshlyAllocated: true })
    ).toBe(true);
  });

  it("never allows cleanup when the identity was reused from a previous run", () => {
    const error = attachDeployFailureDetails(new Error("provider 500"), {
      stage: "apply",
    });
    expect(
      templateCleanupAllowed(error, { identityFreshlyAllocated: false })
    ).toBe(false);
  });

  it("never allows cleanup for readiness-timeout failures", () => {
    const error = attachDeployFailureDetails(
      new Error("Timed out waiting for required result resource readiness."),
      { reason: "readiness-timeout", stage: "readiness" }
    );
    expect(
      templateCleanupAllowed(error, { identityFreshlyAllocated: true })
    ).toBe(false);
  });

  it("never allows cleanup for errors without a typed stage", () => {
    expect(
      templateCleanupAllowed(new Error("timeline write failed"), {
        identityFreshlyAllocated: true,
      })
    ).toBe(false);
  });

  it("never allows cleanup for non-Error failures", () => {
    expect(
      templateCleanupAllowed("thrown string", {
        identityFreshlyAllocated: true,
      })
    ).toBe(false);
  });
});

describe("billing evidence in failure details (catalog E1/E2)", () => {
  const DEBT_EVIDENCE = {
    availableBalanceMicroUnits: -6_320_000,
    checkedAt: "2026-08-28T10:00:00.000Z",
    kind: "account-debt" as const,
  };

  it("keeps the allowlisted billing evidence on the AI runner's public details", () => {
    expect(
      publicDeployTaskFailureDetails({
        details: {
          billingEvidence: DEBT_EVIDENCE,
          errorMessage: "raw gateway text",
          reason: "balance-exhausted",
        },
        runner: { kind: "ai", runtimeProvider: "devbox" },
        status: "failed",
      })
    ).toEqual({
      billingEvidence: DEBT_EVIDENCE,
      failureMessage:
        "Deployment stopped — the account balance is exhausted and the workspace is suspended. Top up, then redeploy.",
      reason: "balance-exhausted",
    });
  });

  it("drops malformed billing evidence instead of trusting it", () => {
    expect(
      publicDeployTaskFailureDetails({
        details: {
          billingEvidence: { kind: "account-debt" } as never,
          reason: "timeout",
        },
        runner: { kind: "ai", runtimeProvider: "devbox" },
        status: "failed",
      })?.billingEvidence
    ).toBeUndefined();
  });

  it("shows the billing check instead of the raw timeout for an exhausted balance, on every runner", () => {
    const detail = deploymentFailureTechnicalDetail({
      details: { billingEvidence: DEBT_EVIDENCE, reason: "balance-exhausted" },
      error:
        "Timed out waiting for deploy Devbox runtime: pod pending for 300s",
      id: "task-1",
      phase: "apply",
      runner: { kind: "template" },
      status: "failed",
    });
    expect(detail).toContain("Reason: balance-exhausted");
    expect(detail).toContain(
      "Billing check: available = balance - deductions + credits = -6.32 <= 0"
    );
    expect(detail).toContain("Checked at: 2026-08-28T10:00:00.000Z");
    expect(detail).toContain("Task ID: task-1");
    expect(detail).not.toContain("Timed out");
  });

  it("appends the quota evidence to a raw runner's own error", () => {
    const detail = deploymentFailureTechnicalDetail({
      details: {
        billingEvidence: {
          kind: "quota-full",
          label: "Storage",
          percentUsed: 100,
          type: "storage",
        },
        reason: "quota-exceeded",
      },
      error: "exceeded quota: requested: requests.storage=2Gi",
      id: "task-1",
      phase: "apply",
      runner: { kind: "template" },
      status: "failed",
    });
    expect(detail).toContain("exceeded quota: requested: requests.storage=2Gi");
    expect(detail).toContain("Quota: Storage at 100%");
  });
});
