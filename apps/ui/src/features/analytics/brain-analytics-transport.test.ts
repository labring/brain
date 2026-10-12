import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configureBrainAnalyticsTransport,
  sendBrainAnalyticsEvent,
} from "./brain-analytics-transport";

const payload = {
  event: "module_view",
  module: "brain",
  context: "app",
  view_name: "project_list",
};

test("iframe events wait for Desktop capability and relay exactly once", () => {
  const previousWindow = globalThis.window;
  const dataLayer: unknown[] = [];
  const relayed: unknown[] = [];
  Object.assign(globalThis, { window: { parent: {}, dataLayer } });
  configureBrainAnalyticsTransport(undefined);
  try {
    sendBrainAnalyticsEvent(payload);
    assert.deepEqual(dataLayer, []);
    assert.equal(relayed.length, 0);
    configureBrainAnalyticsTransport((event) => {
      relayed.push(event);
      return Promise.resolve({ accepted: true });
    });
    assert.deepEqual(relayed, [payload]);
    assert.deepEqual(dataLayer, []);
    configureBrainAnalyticsTransport(null);
    assert.deepEqual(dataLayer, []);
  } finally {
    configureBrainAnalyticsTransport(null);
    Object.assign(globalThis, { window: previousWindow });
  }
});

test("older Desktop falls back to iframe GTM without losing queued events", () => {
  const previousWindow = globalThis.window;
  const dataLayer: unknown[] = [];
  Object.assign(globalThis, { window: { parent: {}, dataLayer } });
  configureBrainAnalyticsTransport(undefined);
  try {
    sendBrainAnalyticsEvent(payload);
    configureBrainAnalyticsTransport(null);
    assert.deepEqual(dataLayer, [payload]);
  } finally {
    configureBrainAnalyticsTransport(null);
    Object.assign(globalThis, { window: previousWindow });
  }
});

test("standalone Brain sends immediately without a Desktop bootstrap", () => {
  const previousWindow = globalThis.window;
  const browserWindow = { parent: null as unknown, dataLayer: [] as unknown[] };
  browserWindow.parent = browserWindow;
  Object.assign(globalThis, { window: browserWindow });
  configureBrainAnalyticsTransport(undefined);
  try {
    sendBrainAnalyticsEvent(payload);
    assert.deepEqual(browserWindow.dataLayer, [payload]);
  } finally {
    configureBrainAnalyticsTransport(null);
    Object.assign(globalThis, { window: previousWindow });
  }
});

test("Desktop acknowledgement failures do not duplicate an event through local GTM", async () => {
  const previousWindow = globalThis.window;
  const previousWarn = console.warn;
  const dataLayer: unknown[] = [];
  let attempts = 0;
  Object.assign(globalThis, { window: { parent: {}, dataLayer } });
  console.warn = () => undefined;
  configureBrainAnalyticsTransport(() => {
    attempts += 1;
    return Promise.reject(new Error("reply lost after delivery"));
  });
  try {
    sendBrainAnalyticsEvent(payload);
    await Promise.resolve();
    assert.equal(attempts, 1);
    assert.deepEqual(dataLayer, []);
  } finally {
    configureBrainAnalyticsTransport(null);
    console.warn = previousWarn;
    Object.assign(globalThis, { window: previousWindow });
  }
});
