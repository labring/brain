import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bringCanvasStackOrderItemToFront,
  resolveCanvasStackOrderRanks,
} from "./stack-order";
import type { CanvasLayoutResourceRef } from "./types";

function ref(kind: CanvasLayoutResourceRef["kind"], name: string) {
  return { kind, name, namespace: "default" };
}

test("stack order defaults AP below DB below EntryPoint until explicit ranks take precedence", () => {
  const ranks = resolveCanvasStackOrderRanks([
    { key: "entry", ref: ref("EntryPoint", "api") },
    { key: "ap", ref: ref("AP", "api") },
    { key: "db", ref: ref("DB", "postgres") },
    { key: "selected-ap", ref: ref("AP", "worker"), stackOrder: 0 },
  ]);

  assert.equal(ranks.get("ap"), 0);
  assert.equal(ranks.get("db"), 1);
  assert.equal(ranks.get("entry"), 2);
  assert.equal(ranks.get("selected-ap"), 3);
});

test("bringing a non-top stack item forward returns the next explicit rank", () => {
  assert.deepEqual(
    bringCanvasStackOrderItemToFront(
      [
        { key: "api", ref: ref("AP", "api") },
        { key: "postgres", ref: ref("DB", "postgres"), stackOrder: 2 },
      ],
      "api"
    ),
    { changed: true, stackOrder: 3 }
  );
});

test("bringing the top stack item forward is a no-op", () => {
  assert.deepEqual(
    bringCanvasStackOrderItemToFront(
      [
        { key: "api", ref: ref("AP", "api") },
        { key: "entry", ref: ref("EntryPoint", "api") },
      ],
      "entry"
    ),
    { changed: false }
  );
});
