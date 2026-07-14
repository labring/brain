import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const dataBrowserRoot = new URL("../", import.meta.url);

function sourceFiles(dir: string): string[] {
  const result: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      result.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      result.push(path);
    }
  }

  return result;
}

test("DB Access source has no direct Zustand or legacy store imports", () => {
  const offenders = sourceFiles(dataBrowserRoot.pathname)
    .filter((file) => !file.endsWith("no-zustand-imports.test.ts"))
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes('from "zustand"') ||
        source.includes("from 'zustand'") ||
        source.includes("@db-browser/stores")
      );
    });

  assert.deepEqual(offenders, []);
});
