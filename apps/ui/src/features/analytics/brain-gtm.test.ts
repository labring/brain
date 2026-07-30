import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BRAIN_GTM_MAX_PAYLOAD_BYTES,
  brainAiEngagementSessionKey,
  brainCardActionEventType,
  brainGtmEventPayloadBytes,
  claimBrainAiEngagement,
  claimBrainAiEngagementFromSession,
  trackBrainGtmEvent,
} from "./brain-gtm";

test("Brain GTM events add the required context and module", () => {
  const previousWindow = globalThis.window;
  const dataLayer: unknown[] = [];
  Object.assign(globalThis, { window: { dataLayer } });

  try {
    assert.equal(
      trackBrainGtmEvent({
        event: "module_view",
        view_name: "project_list",
      }),
      true
    );
    assert.deepEqual(dataLayer, [
      {
        context: "app",
        event: "module_view",
        module: "brain",
        view_name: "project_list",
      },
    ]);
  } finally {
    Object.assign(globalThis, { window: previousWindow });
  }
});

test("Brain GTM drops payloads at or above the 2KB limit", () => {
  const event = {
    app_name: "x".repeat(2100),
    event: "deployment_delete" as const,
    project_id: "project-1",
    reason: "cleanup" as const,
  };

  assert.ok(brainGtmEventPayloadBytes(event) >= BRAIN_GTM_MAX_PAYLOAD_BYTES);
  assert.equal(trackBrainGtmEvent(event), false);
});

test("AI engagement claims once per project in session storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };

  assert.equal(claimBrainAiEngagement(" project-a ", storage), true);
  assert.equal(claimBrainAiEngagement("project-a", storage), false);
  assert.equal(claimBrainAiEngagement("project-b", storage), true);
  assert.equal(
    brainAiEngagementSessionKey("project-a"),
    "brain:gtm:ai-chat-engaged:project-a"
  );
});

test("AI engagement ignores unavailable session storage", () => {
  const previousWindow = globalThis.window;
  const unavailableWindow = {};
  Object.defineProperty(unavailableWindow, "sessionStorage", {
    configurable: true,
    get() {
      throw new Error("session storage unavailable");
    },
  });
  Object.assign(globalThis, { window: unavailableWindow });

  try {
    assert.equal(claimBrainAiEngagementFromSession("project-a"), false);
  } finally {
    Object.assign(globalThis, { window: previousWindow });
  }
});

test("Brain card actions map to semantic surface events", () => {
  assert.equal(
    brainCardActionEventType({
      kind: "apHistory",
      target: { kind: "AP", name: "api", namespace: "ns" },
    }),
    "history_view"
  );
  assert.equal(
    brainCardActionEventType({
      kind: "dbAccess",
      target: { kind: "DB", name: "db", namespace: "ns" },
    }),
    "db_viewer_open"
  );
  assert.equal(
    brainCardActionEventType({
      kind: "settings",
      target: { kind: "AP", name: "api", namespace: "ns" },
    }),
    "status_view"
  );
});
