import assert from "node:assert/strict";
import { test } from "node:test";

import { desktopOpenAppUrl } from "./sealos-desktop-url";

test("desktopOpenAppUrl builds the bare desktop launcher link", () => {
  assert.equal(
    desktopOpenAppUrl("cloud.example.test"),
    "https://cloud.example.test/?openapp="
  );
});

test("desktopOpenAppUrl deep-links an app key", () => {
  assert.equal(
    desktopOpenAppUrl("cloud.example.test", "system-costcenter"),
    "https://cloud.example.test/?openapp=system-costcenter"
  );
});

test("desktopOpenAppUrl keeps an explicit scheme and trims slashes", () => {
  assert.equal(
    desktopOpenAppUrl("http://cloud.example.test///", "system-costcenter"),
    "http://cloud.example.test/?openapp=system-costcenter"
  );
});

test("desktopOpenAppUrl returns null for a blank domain", () => {
  assert.equal(desktopOpenAppUrl("   "), null);
  assert.equal(desktopOpenAppUrl("///"), null);
});
