import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SKILLS_WORKFLOW_PANE_SOURCE = readFileSync(
  new URL("./sealos-skills-workflow-pane.tsx", import.meta.url),
  "utf8"
);
const SKILLS_WORKFLOW_CONTENT_SOURCE = readFileSync(
  new URL("./sealos-skills-workflow-content.tsx", import.meta.url),
  "utf8"
);
const CONCISE_SUBTITLE_RE =
  /subtitle="Set up locally and deploy automatically in 6 steps\."/;
const INSTALL_COMMAND_ROW_CLICK_RE =
  /data-slot="sealos-skills-install-command"[\s\S]{0,240}onClick=/;
const COMMAND_HIGHLIGHT_STATE_RE =
  /const isCommandHighlighted = copied \|\| copyButtonFocused;/;
const COMMAND_HIGHLIGHT_BACKGROUND_RE = /isCommandHighlighted && "bg-input"/;
const COMMAND_HIGHLIGHT_TEXT_RE = /isCommandHighlighted && "text-foreground"/;
const COMMAND_ROW_HOVER_BACKGROUND_RE = /group[\s\S]*hover:bg-input/;
const COMMAND_ROW_HOVER_TEXT_RE = /group-hover:text-foreground/;
const CURRENT_INSTALL_COMMAND_RE =
  /SEALOS_SKILLS_INSTALL_COMMAND[\s\S]{0,180}npx --yes skills@1\.5\.20 add https:\/\/github\.com\/labring\/sealos-skills\.git#codex\/unify-main-brain-deploy -y/;
const LEGACY_INSTALL_COMMAND_RE = /labring\/seakills/;
const INSTALL_COMMAND_ROW_SOURCE =
  SKILLS_WORKFLOW_CONTENT_SOURCE.match(
    /function SealosSkillsInstallCommandRow[\s\S]*?function SealosSkillsSectionHeader/
  )?.[0] ?? "";

test("skills workflow pane subtitle stays concise enough for the header", () => {
  assert.match(SKILLS_WORKFLOW_PANE_SOURCE, CONCISE_SUBTITLE_RE);
});

test("skills workflow install command points to the renamed repository", () => {
  assert.match(SKILLS_WORKFLOW_CONTENT_SOURCE, CURRENT_INSTALL_COMMAND_RE);
  assert.doesNotMatch(
    SKILLS_WORKFLOW_CONTENT_SOURCE,
    LEGACY_INSTALL_COMMAND_RE
  );
});

test("skills workflow flow step titles use continuous numbering", () => {
  const stepNumbers = Array.from(
    SKILLS_WORKFLOW_CONTENT_SOURCE.matchAll(/title: ["'](\d+)\./g),
    (match) => Number(match[1])
  );

  assert.deepEqual(
    stepNumbers,
    Array.from({ length: stepNumbers.length }, (_, index) => index + 1)
  );
});

test("skills workflow install command row keeps copy scoped to the icon button", () => {
  assert.doesNotMatch(INSTALL_COMMAND_ROW_SOURCE, INSTALL_COMMAND_ROW_CLICK_RE);
  assert.match(INSTALL_COMMAND_ROW_SOURCE, COMMAND_HIGHLIGHT_STATE_RE);
  assert.match(INSTALL_COMMAND_ROW_SOURCE, COMMAND_HIGHLIGHT_BACKGROUND_RE);
  assert.match(INSTALL_COMMAND_ROW_SOURCE, COMMAND_HIGHLIGHT_TEXT_RE);
  assert.match(INSTALL_COMMAND_ROW_SOURCE, COMMAND_ROW_HOVER_BACKGROUND_RE);
  assert.match(INSTALL_COMMAND_ROW_SOURCE, COMMAND_ROW_HOVER_TEXT_RE);
});
