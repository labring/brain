import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SKILLS_WORKFLOW_PANE_SOURCE = readFileSync(
  new URL("./sealos-skills-workflow-pane.tsx", import.meta.url),
  "utf8"
);
const CONCISE_SUBTITLE_RE =
  /subtitle="Set up locally and deploy automatically in 7 steps\."/;

test("skills workflow pane subtitle stays concise enough for the header", () => {
  assert.match(SKILLS_WORKFLOW_PANE_SOURCE, CONCISE_SUBTITLE_RE);
});
