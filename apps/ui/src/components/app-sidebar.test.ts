import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const APP_SIDEBAR_SOURCE = readFileSync(
  new URL("./app-sidebar.tsx", import.meta.url),
  "utf8"
);
const BRAIN_V2_ARIA_LABEL_RE = /aria-label="Brain v2"/;
const BRAIN_V2_LOGO_COMPONENT_RE = /BrainV2Logo/;
const PROJECTS_BUTTON_LOGO_ASSET_RE = /sealosLogoSrc/;
const PROJECTS_BUTTON_LOGO_SIZE_RE = /className="relative block size-4"/;
const PROJECTS_BUTTON_ACTIVE_BACKGROUND_OVERRIDE_RE =
  /className="aria-\[current=page\]:bg-transparent!"/;
const PROJECTS_BUTTON_PROJECT_HOVER_RE =
  /showGridOnHover=\{currentProjectId !== undefined\}/;

test("app sidebar does not reserve space for the Brain v2 logo", () => {
  assert.doesNotMatch(APP_SIDEBAR_SOURCE, BRAIN_V2_ARIA_LABEL_RE);
  assert.doesNotMatch(APP_SIDEBAR_SOURCE, BRAIN_V2_LOGO_COMPONENT_RE);
});

test("app sidebar projects button defaults to the logo and only shows grid on project hover", () => {
  assert.match(APP_SIDEBAR_SOURCE, PROJECTS_BUTTON_LOGO_ASSET_RE);
  assert.match(APP_SIDEBAR_SOURCE, PROJECTS_BUTTON_LOGO_SIZE_RE);
  assert.match(
    APP_SIDEBAR_SOURCE,
    PROJECTS_BUTTON_ACTIVE_BACKGROUND_OVERRIDE_RE
  );
  assert.match(APP_SIDEBAR_SOURCE, PROJECTS_BUTTON_PROJECT_HOVER_RE);
});
