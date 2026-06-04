import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectExplorer } from "./project-explorer";

const states = {
  projects: [],
};
const ARIA_LABEL_RE = /aria-label="New Project"/;
const BUTTON_RE = /<button[^>]*>(.*?)<\/button>/;
const COMPACT_WIDTH_RE = /w-9/;
const NEW_PROJECT_TEXT_RE = />New Project</;
const RELAXED_WIDTH_RE = /w-32[^"]*transition-\[width\]/;
const SVG_RE = /<svg/;

function renderHeaderButton(iconOnly = false) {
  const html = renderToStaticMarkup(
    <ProjectExplorer.Root states={states}>
      <ProjectExplorer.Variant1 newProjectButtonIconOnly={iconOnly} />
    </ProjectExplorer.Root>
  );
  const match = html.match(BUTTON_RE);
  assert.ok(match, "new project button should render");
  return {
    buttonHtml: match[0],
    html,
  };
}

test("project explorer new-project action renders text by default", () => {
  const { buttonHtml } = renderHeaderButton();

  assert.match(buttonHtml, NEW_PROJECT_TEXT_RE);
  assert.match(buttonHtml, RELAXED_WIDTH_RE);
  assert.doesNotMatch(buttonHtml, ARIA_LABEL_RE);
});

test("project explorer can render compact icon-only new-project action", () => {
  const { buttonHtml } = renderHeaderButton(true);

  assert.match(buttonHtml, ARIA_LABEL_RE);
  assert.match(buttonHtml, COMPACT_WIDTH_RE);
  assert.match(buttonHtml, SVG_RE);
  assert.doesNotMatch(buttonHtml, NEW_PROJECT_TEXT_RE);
});
