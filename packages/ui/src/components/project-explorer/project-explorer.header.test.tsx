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
const TOOLTIP_TEXT_RE = /<span[^>]*>New Project<\/span>/;

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
  assert.match(buttonHtml, SVG_RE);
  assert.match(html, TOOLTIP_TEXT_RE);
});
