import assert from "node:assert/strict";
import { test } from "node:test";
import { serializeProjectSideSurfaceEntry } from "@/features/panes/url-codec";
import {
  createSettingsLaunchContextStore,
  settingsLaunchContextKey,
} from "./settings-launch-context";

const apEnvironmentEntry = {
  kind: "settings",
  target: { kind: "AP", name: "api", namespace: "default" },
  view: "environment",
} as const;

const apPublicAddressesEntry = {
  kind: "settings",
  target: { kind: "AP", name: "api", namespace: "default" },
  view: "public-addresses",
} as const;

test("Settings Launch Context is keyed by surface slot and full settings entry identity", () => {
  assert.notEqual(
    settingsLaunchContextKey({
      entry: apEnvironmentEntry,
      slot: "side",
    }),
    settingsLaunchContextKey({
      entry: apPublicAddressesEntry,
      slot: "side",
    })
  );

  assert.notEqual(
    settingsLaunchContextKey({
      entry: apEnvironmentEntry,
      slot: "side",
    }),
    settingsLaunchContextKey({
      entry: apEnvironmentEntry,
      slot: "main",
    })
  );
});

test("Settings Launch Context stores session-local launch source and transient intent without entering route state", () => {
  const store = createSettingsLaunchContextStore();

  store.set({
    context: {
      launchSource: "canvas",
      pendingDatabaseBindingIntent: {
        dbName: "postgres",
        dbNamespace: "default",
        id: "ap-db-1",
      },
    },
    entry: apEnvironmentEntry,
    slot: "side",
  });

  assert.deepEqual(store.get({ entry: apEnvironmentEntry, slot: "side" }), {
    launchSource: "canvas",
    pendingDatabaseBindingIntent: {
      dbName: "postgres",
      dbNamespace: "default",
      id: "ap-db-1",
    },
  });
  assert.equal(
    store.get({ entry: apPublicAddressesEntry, slot: "side" }),
    undefined
  );
  assert.equal(
    serializeProjectSideSurfaceEntry(apEnvironmentEntry),
    "settings:ap:default:api:environment"
  );
});

test("route restoration creates only a route launch source for the active entry", () => {
  const store = createSettingsLaunchContextStore();

  store.setRouteRestored({ entry: apEnvironmentEntry, slot: "side" });

  assert.deepEqual(store.get({ entry: apEnvironmentEntry, slot: "side" }), {
    launchSource: "route",
  });
});

test("closing a surface removes its matching Settings Launch Context", () => {
  const store = createSettingsLaunchContextStore();
  store.set({
    context: { launchSource: "assistant" },
    entry: apEnvironmentEntry,
    slot: "side",
  });

  store.delete({ entry: apEnvironmentEntry, slot: "side" });

  assert.equal(
    store.get({ entry: apEnvironmentEntry, slot: "side" }),
    undefined
  );
});
