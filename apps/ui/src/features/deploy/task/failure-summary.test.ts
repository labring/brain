import { describe, expect, it } from "bun:test";

import {
  aiFailureReason,
  deploymentFailureMessage,
  deploymentFailureReason,
  deployRunnerSurfacesRawFailure,
} from "./failure-summary";
import type { DeployTaskFailureReason } from "./schema";

const UNKNOWN_FAILURE_MESSAGE =
  "Deployment failed for an unknown reason. Copy the Task ID and contact support.";

describe("deployRunnerSurfacesRawFailure", () => {
  it("surfaces raw errors for deterministic runners", () => {
    expect(deployRunnerSurfacesRawFailure({ kind: "template" })).toBe(true);
    expect(deployRunnerSurfacesRawFailure({ kind: "direct" })).toBe(true);
  });

  it("does not surface raw errors for the AI runner", () => {
    expect(deployRunnerSurfacesRawFailure({ kind: "ai" })).toBe(false);
  });
});

describe("deploymentFailureReason", () => {
  it("maps a known Kubernetes quota failure for runners that surface raw errors", () => {
    const message =
      "admission webhook denied the request: exceeded quota: default-quota, requested: cpu=2";
    expect(
      deploymentFailureReason({ rawMessage: message, surfacesRaw: true })
    ).toBe("Namespace resource quota exceeded.");
  });

  it("never applies substring-class headlines to unscrubbed runners", () => {
    // The AI runner has no raw safety net, so a false-positive substring must
    // not label its failure (ADR 0042).
    expect(
      deploymentFailureReason({
        rawMessage: "mkdir: /app already exists",
        surfacesRaw: false,
      })
    ).toBe(UNKNOWN_FAILURE_MESSAGE);
  });

  it("maps a name conflict and an invalid-value rejection", () => {
    expect(
      deploymentFailureReason({
        rawMessage: 'instances.app "my-app" already exists',
        surfacesRaw: true,
      })
    ).toBe("A resource with this name already exists.");
    expect(
      deploymentFailureReason({
        rawMessage: "Deployment.apps spec.replicas: Invalid value: -1",
        surfacesRaw: true,
      })
    ).toBe("The deployment values were rejected as invalid.");
  });

  it("falls back to the raw first line for scrubbed runners when unmapped", () => {
    expect(
      deploymentFailureReason({
        rawMessage: "template provider returned 503\nstack frame\nstack frame",
        surfacesRaw: true,
      })
    ).toBe("template provider returned 503");
  });

  it("keeps the generic string for unscrubbed runners when unmapped", () => {
    expect(
      deploymentFailureReason({
        rawMessage: "template provider returned 503",
        surfacesRaw: false,
      })
    ).toBe(UNKNOWN_FAILURE_MESSAGE);
  });

  it("maps the readiness-timeout reason code for every runner", () => {
    // Reason codes are fixed system verdicts, not raw echoes, so they apply
    // regardless of whether the runner surfaces raw errors.
    expect(
      deploymentFailureReason({
        reasonCode: "readiness-timeout",
        surfacesRaw: true,
      })
    ).toBe(
      "Deployment resources didn't become ready in time. Created resources were preserved — Redeploy reuses them."
    );
    expect(
      deploymentFailureReason({
        reasonCode: "readiness-timeout",
        surfacesRaw: false,
      })
    ).toBe(
      "Deployment resources didn't become ready in time. Created resources were preserved — Redeploy reuses them."
    );
  });

  it("preserves curated AI headlines while never leaking raw AI text", () => {
    expect(
      deploymentFailureReason({
        rawMessage: "No valid skills found. Skills require a SKILL.md",
        surfacesRaw: false,
      })
    ).toBe(
      "Deploy skill installation failed. Redeploy; if the problem continues, contact support."
    );
    expect(
      deploymentFailureReason({
        rawMessage: "some private gateway stderr",
        surfacesRaw: false,
      })
    ).toBe(UNKNOWN_FAILURE_MESSAGE);
  });

  it("truncates an overlong first line", () => {
    const reason = deploymentFailureReason({
      rawMessage: `${"x".repeat(400)} tail`,
      surfacesRaw: true,
    });
    expect(reason.length).toBeLessThanOrEqual(200);
    expect(reason.endsWith("…")).toBe(true);
  });

  it("returns the generic string when there is nothing to show", () => {
    expect(deploymentFailureReason({ surfacesRaw: true })).toBe(
      UNKNOWN_FAILURE_MESSAGE
    );
  });

  it("maps every stable reason code to a distinct user-facing explanation", () => {
    const expectedFragments = {
      "ai-proxy-unavailable": "credentials could not be prepared",
      "apply-failed": "could not be applied",
      "balance-exhausted": "balance is exhausted",
      "build-runtime-unavailable": "required build service",
      "buildkit-start-failed": "BuildKit could not start",
      cancelled: "was cancelled",
      "deploy-configuration-invalid": "not configured correctly",
      "deploy-runtime-unavailable": "workspace did not become ready",
      "deploy-skill-install-failed": "skill installation failed",
      "deployment-output-missing": "without a deployable result",
      "template-output-invalid": "invalid deployment template",
      "gateway-not-exposed": "did not expose",
      "gateway-timeout": "analysis timed out",
      "gateway-unavailable": "service is unavailable",
      "gateway-upstream-error": "returned an error",
      "github-authentication": "Reconnect GitHub",
      "image-build-failed": "image could not be built",
      interrupted: "interrupted by the platform",
      "never-started": "could not start",
      "quota-exceeded": "enough quota",
      "readiness-timeout": "didn't become ready",
      "repository-clone-failed": "could not be cloned",
      "runner-error": "internal error",
      "subscription-expired": "expired subscription",
      timeout: "maximum run time",
      unknown: "unknown reason",
    } satisfies Record<DeployTaskFailureReason, string>;

    for (const reason of Object.keys(
      expectedFragments
    ) as DeployTaskFailureReason[]) {
      expect(deploymentFailureMessage(reason)).toContain(
        expectedFragments[reason]
      );
    }
  });

  it("classifies legacy AI boundary messages without exposing their text", () => {
    expect(aiFailureReason("No valid skills found")).toBe(
      "deploy-skill-install-failed"
    );
    expect(aiFailureReason("Timed out waiting for deploy Devbox runtime")).toBe(
      "deploy-runtime-unavailable"
    );
    expect(aiFailureReason("BuildKit build could not start")).toBe(
      "buildkit-start-failed"
    );
    expect(
      aiFailureReason("Codex gateway completed without deployment output")
    ).toBe("deployment-output-missing");
    expect(aiFailureReason("Rendered Sealos template is not valid YAML.")).toBe(
      "template-output-invalid"
    );
    expect(
      aiFailureReason(
        'Generated Sealos template declaration is invalid for input "smtp_from_address".'
      )
    ).toBe("template-output-invalid");
  });
});

describe("billing interruption vocabulary (catalog E1/E2)", () => {
  it("names an exhausted balance and its suspension in the reason message", () => {
    expect(deploymentFailureMessage("balance-exhausted")).toBe(
      "Deployment stopped — the account balance is exhausted and the workspace is suspended. Top up, then redeploy."
    );
  });

  it("gives the dock chip a reason phrase only for money and quota walls", async () => {
    const { deploymentFailureChipPhrase } = await import("./failure-summary");
    expect(deploymentFailureChipPhrase("balance-exhausted")).toBe(
      "out of balance"
    );
    expect(deploymentFailureChipPhrase("quota-exceeded")).toBe("quota full");
    expect(deploymentFailureChipPhrase("timeout")).toBeNull();
    expect(deploymentFailureChipPhrase(null)).toBeNull();
  });
});
