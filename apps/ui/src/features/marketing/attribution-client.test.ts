import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { readMarketingAttribution } from "./attribution-client";

const ATTRIBUTION_STORAGE_KEY = "sealos_attr_v3";
const TEST_GCLID_RE = /gclid-123/;

class MemoryStorage {
  private readonly values = new Map<string, string>();

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const localStorage = new MemoryStorage();
const browser = {
  atob,
  localStorage,
  location: { href: "https://cloud.sealos.io/" },
};
const originalWindow = globalThis.window;

const touch = {
  campaign: "caf\u00e9-search",
  channel: "paid_search",
  click_id_type: "gclid",
  click_id_value: "gclid-123",
  content: "repo-to-url",
  landing_hostname: "sealos.io",
  landing_path: "/",
  medium: "paid",
  source: "google",
  term: "deploy repo",
  ts: "2026-08-06T08:00:00.000Z",
};

function encodedState(adUserDataConsent?: boolean): string {
  const state = {
    ...(adUserDataConsent === undefined
      ? {}
      : { ad_user_data_consent: adUserDataConsent }),
    first_touch: touch,
    gbraid: null,
    gclid: "gclid-123",
    last_qualified_touch: touch,
    last_touch: touch,
    version: 2,
    wbraid: null,
  };
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

beforeEach(() => {
  Object.assign(globalThis, { window: browser });
  localStorage.clear();
  browser.location.href = "https://cloud.sealos.io/";
});

afterEach(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }
  Object.assign(globalThis, { window: originalWindow });
});

test("product attribution keeps a click ID with explicit consent", () => {
  browser.location.href = `https://cloud.sealos.io/?sea_attr=${encodedState(true)}&consent_token=signed-token`;

  const result = readMarketingAttribution();

  assert.equal(result?.ad_user_data_consent, "granted");
  assert.equal(result?.gclid, "gclid-123");
  assert.equal(result?.first_touch?.campaign, "caf\u00e9-search");
  assert.equal(
    result?.attribution_raw,
    browser.location.href.split("sea_attr=")[1]?.split("&")[0]
  );
  assert.match(
    localStorage.getItem(ATTRIBUTION_STORAGE_KEY) ?? "",
    TEST_GCLID_RE
  );
});

test("product attribution redacts a click ID after consent withdrawal", () => {
  browser.location.href = `https://cloud.sealos.io/?sea_attr=${encodedState(false)}&consent_token=signed-token`;

  const result = readMarketingAttribution();

  assert.equal(result?.ad_user_data_consent, "denied");
  assert.equal(result?.gclid, null);
  assert.equal(result?.first_touch?.click_id_value, "");
  assert.doesNotMatch(
    localStorage.getItem(ATTRIBUTION_STORAGE_KEY) ?? "",
    TEST_GCLID_RE
  );
});

test("legacy attribution requires a fresh explicit consent signal", () => {
  browser.location.href = `https://cloud.sealos.io/?sea_attr=${encodedState()}`;

  const result = readMarketingAttribution();

  assert.equal(result?.ad_user_data_consent, "unspecified");
  assert.equal(result?.gclid, null);
});
