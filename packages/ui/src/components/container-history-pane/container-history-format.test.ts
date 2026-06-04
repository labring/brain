import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSnapshotAge,
  imageVersionLabel,
} from "./container-history-format";

test("image version label prefers tags over version hashes", () => {
  assert.equal(
    imageVersionLabel({
      image: "ghcr.io/sealai/orders-api:2026.03.31",
      versionHash: "deadbeefcafe1234",
    }),
    "2026.03.31"
  );
});

test("image version label shortens digest image refs", () => {
  assert.equal(
    imageVersionLabel({
      image: "registry.example.io/demo@sha256:1234567890abcdef1234567890abcdef",
      versionHash: "deadbeefcafe1234",
    }),
    "1234567890ab"
  );
});

test("image version label falls back to short version hash", () => {
  assert.equal(
    imageVersionLabel({
      image: "registry.example.io/demo",
      versionHash: "deadbeefcafe1234",
    }),
    "deadbeefcafe"
  );
});

test("snapshot age renders relative time", () => {
  const now = Date.parse("2026-03-31T12:00:00.000Z");
  assert.equal(
    formatSnapshotAge("2026-03-31T10:00:00.000Z", now),
    "2 hours ago"
  );
  assert.equal(
    formatSnapshotAge("2026-03-31T12:00:10.000Z", now),
    "in 10 seconds"
  );
});
