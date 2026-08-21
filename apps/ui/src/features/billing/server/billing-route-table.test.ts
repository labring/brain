import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BILLING_ROUTES } from "./billing-route-table";

const API_BILLING_DIR = fileURLToPath(
  new URL("../../../app/api/billing", import.meta.url)
);

function apiPathsOnDisk(): string[] {
  const apiPaths: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}/${entry.name}`);
      } else if (entry.name === "route.ts") {
        apiPaths.push(`/api/billing${prefix}`);
      }
    }
  };
  walk(API_BILLING_DIR, "");
  return apiPaths.sort();
}

test("the route table and the route files on disk agree exactly", () => {
  // Both directions matter: a table entry without a route file is a dead
  // mapping, and a route file without a table entry silently escapes the
  // dev-mock contract tests.
  const tablePaths = Object.values(BILLING_ROUTES)
    .map((entry) => entry.apiPath)
    .sort();
  assert.deepEqual(tablePaths, apiPathsOnDisk());
});

test("upstream pathnames are unique", () => {
  const upstreams = Object.values(BILLING_ROUTES).map(
    (entry) => entry.upstreamPathname
  );
  assert.equal(new Set(upstreams).size, upstreams.length);
});
