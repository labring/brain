import assert from "node:assert/strict";
import { test } from "node:test";

import { createStore } from "jotai";
import { dbAccessRevealedSystemObjectsAtom } from "./db-access-session";

test("system object reveal state is scoped to one DB Access Session store", () => {
  // DbAccessSessionProvider creates a fresh jotai store per dbServiceKey, so
  // the reveal state must live in the store — never at module scope or in
  // localStorage — for switching DB Services to reset it (ADR 0049/0054).
  const currentSession = createStore();
  currentSession.set(dbAccessRevealedSystemObjectsAtom, new Set(["app"]));
  assert.equal(
    currentSession.get(dbAccessRevealedSystemObjectsAtom).has("app"),
    true
  );

  const nextSession = createStore();
  assert.equal(nextSession.get(dbAccessRevealedSystemObjectsAtom).size, 0);
});
