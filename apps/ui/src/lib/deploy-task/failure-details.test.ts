import { describe, expect, it } from "bun:test";

import {
  attachDeployFailureDetails,
  attachedDeployFailureDetails,
  templateCleanupAllowed,
} from "./failure-details";

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
