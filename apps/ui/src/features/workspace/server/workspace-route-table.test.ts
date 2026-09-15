import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { WORKSPACE_ROUTES } from "./workspace-route-table";

const API_WORKSPACE_DIR = fileURLToPath(
  new URL("../../../app/api/workspace", import.meta.url)
);

function apiPathsOnDisk(): string[] {
  const apiPaths: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}/${entry.name}`);
      } else if (entry.name === "route.ts") {
        apiPaths.push(`/api/workspace${prefix}`);
      }
    }
  };
  if (existsSync(API_WORKSPACE_DIR)) {
    walk(API_WORKSPACE_DIR, "");
  }
  return apiPaths.sort();
}

test("the Workspace route table and the route files on disk agree exactly", () => {
  // Both directions matter (same guard as the billing table): a table entry
  // without a route file is a dead mapping, and a route file without a
  // table entry escapes the dev-mock contract test.
  const tablePaths = Object.values(WORKSPACE_ROUTES)
    .map((entry) => entry.apiPath)
    .sort();
  assert.deepEqual(tablePaths, apiPathsOnDisk());
});

test("Desktop pathnames are unique", () => {
  const desktopPaths = Object.values(WORKSPACE_ROUTES).map(
    (entry) => entry.desktopPath
  );
  assert.equal(new Set(desktopPaths).size, desktopPaths.length);
});
