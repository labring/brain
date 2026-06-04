import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  formatEventAge,
  formatLoadedEventCount,
  formatWorkloadEventsSubtitle,
  WorkloadEventCard,
  workloadEventTypeClassName,
} from "./workload-events-panel";

test("AP workload event age switches old past events to absolute dates", () => {
  const now = Date.parse("2026-06-15T12:00:00Z");

  assert.equal(formatEventAge("2026-06-09T12:00:00Z", now), "6 days ago");
  assert.equal(formatEventAge("2026-06-08T12:00:00Z", now), "Jun 8, 12:00 PM");
  assert.equal(
    formatEventAge("2025-12-28T09:30:00Z", now),
    "Dec 28, 2025, 9:30 AM"
  );
});

test("AP workload events count labels distinguish truncated latest results", () => {
  assert.equal(formatLoadedEventCount(0, 50), "0 Items");
  assert.equal(formatLoadedEventCount(1, 50), "1 Item");
  assert.equal(formatLoadedEventCount(12, 50), "12 Items");
  assert.equal(formatLoadedEventCount(50, 50), "Latest 50");
});

test("AP workload events subtitle reflects loading error and ready states", () => {
  const prefix = "Instance scheduling, startup, and health check events.";

  assert.equal(
    formatWorkloadEventsSubtitle({ count: 0, state: "loading" }),
    `${prefix} Loading`
  );
  assert.equal(
    formatWorkloadEventsSubtitle({ count: 0, state: "error" }),
    `${prefix} Unavailable`
  );
  assert.equal(
    formatWorkloadEventsSubtitle({ count: 0, state: "ready" }),
    `${prefix} 0 Items`
  );
  assert.equal(
    formatWorkloadEventsSubtitle({ count: 50, state: "ready" }),
    `${prefix} Latest 50`
  );
});

test("AP workload events type tone maps Kubernetes event types", () => {
  assert.equal(workloadEventTypeClassName("Normal"), "text-green-500");
  assert.equal(workloadEventTypeClassName("Warning"), "text-yellow-500");
  assert.equal(workloadEventTypeClassName(""), "text-muted-foreground");
  assert.equal(workloadEventTypeClassName(undefined), "text-muted-foreground");
});

test("AP workload event card keeps event content with an absolute date status", () => {
  const html = renderToStaticMarkup(
    createElement(WorkloadEventCard, {
      event: {
        count: 4,
        firstTimestamp: "2025-12-28T09:30:00Z",
        involvedObject: {
          kind: "Pod",
          name: "rooted-nelson-dwsf-zton-7549bf855f-wvf8b",
        },
        lastTimestamp: "2025-12-28T09:30:00Z",
        message:
          "Unable to retrieve some image pull secrets; attempting to pull the image may not succeed.",
        reason: "FailedToRetrieveImagePullSecret",
        type: "Warning",
      },
    })
  );

  assert.ok(html.includes("FailedToRetrieveImagePullSecret"));
  assert.ok(html.includes("Pod rooted-nelson"));
  assert.ok(html.includes("Unable to retrieve"));
  assert.ok(html.includes("Repeated 4 times"));
  assert.ok(html.includes("text-yellow-500"));
  assert.ok(html.includes("flex-1"));
  assert.ok(html.includes("max-w-60"));
});
