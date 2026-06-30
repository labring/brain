import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectExplorer } from "./project-explorer";

const states = {
  projects: [],
};
const ARIA_LABEL_RE = /aria-label="New Project"/;
const BUTTON_RE = /<button[^>]*>(.*?)<\/button>/;
const NEW_PROJECT_TEXT_RE = />New Project</;
const RESPONSIVE_ACTION_RE = /project-explorer-new-project-action/;
const RESPONSIVE_BUTTON_RE = /project-explorer-new-project-button/;
const RESPONSIVE_LABEL_RE = /project-explorer-new-project-label/;
const SVG_RE = /<svg/;
const LIGHTENED_BLUE_STATE_CLASS =
  "bg-[color-mix(in_oklab,var(--color-blue-500)_90%,white_10%)]";
const TOOLTIP_TEXT_RE = /<span[^>]*>New Project<\/span>/;
const SYSTEM_CONFIG_TITLE_RE = /System configuration unavailable/;
const SYSTEM_CONFIG_DESCRIPTION_RE =
  /Project history is temporarily unavailable/;

function renderHeaderButton() {
  const html = renderToStaticMarkup(
    <ProjectExplorer.Root states={states}>
      <ProjectExplorer.Variant1 />
    </ProjectExplorer.Root>
  );
  const match = html.match(BUTTON_RE);
  assert.ok(match, "new project button should render");
  return {
    buttonHtml: match[0],
    html,
  };
}

test("project explorer new-project action renders responsive default content", () => {
  const { buttonHtml, html } = renderHeaderButton();

  assert.match(html, RESPONSIVE_ACTION_RE);
  assert.match(buttonHtml, NEW_PROJECT_TEXT_RE);
  assert.match(buttonHtml, ARIA_LABEL_RE);
  assert.match(buttonHtml, RESPONSIVE_BUTTON_RE);
  assert.match(buttonHtml, RESPONSIVE_LABEL_RE);
  assert.ok(buttonHtml.includes(`hover:${LIGHTENED_BLUE_STATE_CLASS}`));
  assert.ok(buttonHtml.includes(`active:${LIGHTENED_BLUE_STATE_CLASS}`));
  assert.match(buttonHtml, SVG_RE);
  assert.match(html, TOOLTIP_TEXT_RE);
});

test("project explorer renders custom empty-state messaging", () => {
  const html = renderToStaticMarkup(
    <ProjectExplorer.Root
      states={{
        empty: {
          description:
            "Project history is temporarily unavailable because the app database cannot be reached.",
          title: "System configuration unavailable",
        },
        projects: [],
      }}
    >
      <ProjectExplorer.Variant1 />
    </ProjectExplorer.Root>
  );

  assert.match(html, SYSTEM_CONFIG_TITLE_RE);
  assert.match(html, SYSTEM_CONFIG_DESCRIPTION_RE);
});
