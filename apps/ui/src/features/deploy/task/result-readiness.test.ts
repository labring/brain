import { describe, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

import type { DeploymentResultResourceCard } from "./timeline";

const requireModule = createRequire(import.meta.url);

mock.module("server-only", () => ({}));

const { resultReadinessForPresentation, waitingForResultObservationStatus } =
  requireModule("./result-readiness") as typeof import("./result-readiness");

const card: DeploymentResultResourceCard = {
  events: [],
  id: "TemplateWorkload:ns-demo:Deployment:demo-api",
  required: true,
  resultRef: {
    kind: "TemplateWorkload",
    name: "demo-api",
    namespace: "ns-demo",
    workloadKind: "Deployment",
  },
  status: "creating",
  title: "demo-api",
};

describe("result observation error presentation", () => {
  it("preserves provider details for deterministic runners", () => {
    expect(
      waitingForResultObservationStatus(
        card,
        new Error("provider-detail-token"),
        { surfaceObservationError: true }
      )
    ).toBe(
      "Waiting for Deployment demo-api observation: provider-detail-token"
    );
  });

  it("uses a fixed status when provider details must stay private", () => {
    const status = waitingForResultObservationStatus(
      card,
      new Error("provider-detail-token"),
      { surfaceObservationError: false }
    );

    expect(status).toBe("Waiting for Deployment demo-api observation.");
    expect(status).not.toContain("provider-detail-token");
  });

  it("normalizes successful provider observations for private runners", () => {
    const observed = resultReadinessForPresentation(
      card,
      {
        eventMessage: "provider-status-token",
        latestStatusText: "provider-status-token",
        status: "creating",
      },
      { surfaceObservationError: false }
    );

    expect(observed.status).toBe("creating");
    expect(observed.latestStatusText).toBe(
      "Waiting for Deployment demo-api readiness."
    );
    expect(observed.eventMessage).toBe(observed.latestStatusText);
    expect(JSON.stringify(observed)).not.toContain("provider-status-token");
  });

  it("retains successful provider observations for deterministic runners", () => {
    const observed = resultReadinessForPresentation(
      card,
      {
        eventMessage: "provider-status-token",
        latestStatusText: "provider-status-token",
        status: "creating",
      },
      { surfaceObservationError: true }
    );

    expect(observed.latestStatusText).toContain("provider-status-token");
    expect(observed.eventMessage).toContain("provider-status-token");
  });
});
