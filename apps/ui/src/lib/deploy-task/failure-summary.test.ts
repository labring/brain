import { describe, expect, it } from "bun:test";

import {
  deploymentFailureReason,
  deployRunnerSurfacesRawFailure,
} from "./failure-summary";

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
    ).toBe("Deployment task failed.");
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
    ).toBe("Deployment task failed.");
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
    ).toBe("Deploy skill installation failed.");
    expect(
      deploymentFailureReason({
        rawMessage: "some private gateway stderr",
        surfacesRaw: false,
      })
    ).toBe("Deployment task failed.");
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
      "Deployment task failed."
    );
  });
});
