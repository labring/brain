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
  /showIconOnHover=\{currentProjectId !== undefined\}/;
const WORKSPACE_QUOTA_LOADER_RE = /sealosApp\.getWorkspaceQuota\(\)/;
const DESKTOP_HOST_CONFIG_RE = /sealosApp\.getHostConfig\(\)/;
const DESKTOP_HOST_DOMAIN_RE = /hostConfig\.cloud\.domain/;
const CREATE_SEALOS_APP_RE = /createSealosApp/;
const HARDCODED_USAGE_VALUE_RE = /"0\.0\/0"/;
const DESKTOP_RETURN_BUTTON_RE = /aria-label="Back to Sealos Desktop"/;
const DESKTOP_RETURN_NEW_TAB_RE =
  /href=\{desktopUrl\}[\s\S]*rel="noopener noreferrer"[\s\S]*target="_blank"/;
const DESKTOP_RETURN_DISABLED_RE = /disabled=\{desktopUrl === null\}/;
const HARD_CODED_DESKTOP_DOMAIN_RE = /usw-1\.sealos\.io/;
const CLOSE_BRAIN_EVENT_RE = /closeDesktopApp/;
const DESKTOP_RETURN_BEFORE_UPGRADE_RE =
  /data-slot="app-sidebar-bottom-actions"[\s\S]*<AppSidebarDesktopReturn \/>[\s\S]*<AppSidebarUpgrade \/>/;
const EMBEDDED_WINDOW_CHECK_RE = /window\.(?:self|top)/;

test("app sidebar does not reserve space for the Brain v2 logo", () => {
  assert.doesNotMatch(APP_SIDEBAR_SOURCE, BRAIN_V2_ARIA_LABEL_RE);
  assert.doesNotMatch(APP_SIDEBAR_SOURCE, BRAIN_V2_LOGO_COMPONENT_RE);
});

test("app sidebar projects button defaults to the logo and only shows the layout icon on project hover", () => {
  assert.match(APP_SIDEBAR_SOURCE, PROJECTS_BUTTON_LOGO_ASSET_RE);
  assert.match(APP_SIDEBAR_SOURCE, PROJECTS_BUTTON_LOGO_SIZE_RE);
  assert.match(
    APP_SIDEBAR_SOURCE,
    PROJECTS_BUTTON_ACTIVE_BACKGROUND_OVERRIDE_RE
  );
  assert.match(APP_SIDEBAR_SOURCE, PROJECTS_BUTTON_PROJECT_HOVER_RE);
});

test("app sidebar upgrade popover reads workspace quota from the Sealos SDK", () => {
  assert.match(APP_SIDEBAR_SOURCE, WORKSPACE_QUOTA_LOADER_RE);
  assert.doesNotMatch(APP_SIDEBAR_SOURCE, CREATE_SEALOS_APP_RE);
  assert.doesNotMatch(APP_SIDEBAR_SOURCE, HARDCODED_USAGE_VALUE_RE);
});

test("app sidebar opens Sealos Desktop in a new tab", () => {
  assert.match(APP_SIDEBAR_SOURCE, DESKTOP_HOST_CONFIG_RE);
  assert.match(APP_SIDEBAR_SOURCE, DESKTOP_HOST_DOMAIN_RE);
  assert.match(APP_SIDEBAR_SOURCE, DESKTOP_RETURN_NEW_TAB_RE);
  assert.match(APP_SIDEBAR_SOURCE, DESKTOP_RETURN_DISABLED_RE);
  assert.doesNotMatch(APP_SIDEBAR_SOURCE, HARD_CODED_DESKTOP_DOMAIN_RE);
  assert.doesNotMatch(APP_SIDEBAR_SOURCE, CLOSE_BRAIN_EVENT_RE);
});

test("app sidebar always renders the Desktop return button above Upgrade", () => {
  assert.match(APP_SIDEBAR_SOURCE, DESKTOP_RETURN_BUTTON_RE);
  assert.match(APP_SIDEBAR_SOURCE, DESKTOP_RETURN_BEFORE_UPGRADE_RE);
  assert.doesNotMatch(APP_SIDEBAR_SOURCE, EMBEDDED_WINDOW_CHECK_RE);
});
