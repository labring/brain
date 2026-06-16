import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectExplorerRoot } from "./project-explorer.context";
import {
  isProjectDeleteVerificationMatch,
  ProjectExplorerListItem,
} from "./project-explorer.list-item";

const PROJECT_NAME_RE = /orders-api/;
const PROJECT_DESCRIPTION_RE = /Handles order traffic\./;
const PROJECT_DESCRIPTION_LAYOUT_RE =
  /<p class="[^"]*\bcol-span-full\b[^"]*\brow-start-2\b[^"]*"/;
const PROJECT_ROW_DESCRIPTION_PADDING_RE =
  /<div class="[^"]*\bproject-explorer-item-row\b[^"]* pb-\[18px\][^"]*"/;
const PROJECT_ROW_COMPACT_PADDING_RE =
  /<div class="[^"]*\bproject-explorer-item-row\b[^"]* pb-2\.5[^"]*"/;
const PROJECT_ROW_COMPACT_CENTER_RE =
  /<div class="[^"]*\bproject-explorer-item-row\b[^"]*\bitems-center\b[^"]*"/;
const PROJECT_STATUS_DOT_TOP_OFFSET_RE = /mt-\[3px\]/;

test("project delete confirmation matches the Project Display Name", () => {
  assert.equal(
    isProjectDeleteVerificationMatch(
      "Brain Template E2E 0610103045",
      "Brain Template E2E 0610103045"
    ),
    true
  );
});

test("project delete confirmation trims surrounding whitespace", () => {
  assert.equal(
    isProjectDeleteVerificationMatch(
      "  Brain Template E2E 0610103045  ",
      "Brain Template E2E 0610103045"
    ),
    true
  );
});

test("project delete confirmation does not accept the Project ID", () => {
  assert.equal(
    isProjectDeleteVerificationMatch(
      "6bf1a225-7e79-4724-ad46-aa5bf38e1112",
      "Brain Template E2E 0610103045"
    ),
    false
  );
});

test("project delete confirmation keeps display-name casing strict", () => {
  assert.equal(
    isProjectDeleteVerificationMatch(
      "brain template e2e 0610103045",
      "Brain Template E2E 0610103045"
    ),
    false
  );
});

test("project explorer item renders Project Description when present", () => {
  const html = renderToStaticMarkup(
    createElement(
      ProjectExplorerRoot,
      {
        actions: { onProjectUpdate: () => undefined },
        states: { projects: [] },
      },
      createElement(ProjectExplorerListItem, {
        project: {
          createdAt: "2026-05-26T00:00:00.000Z",
          description: "Handles order traffic.",
          id: "project-1",
          name: "orders-api",
        },
      })
    )
  );

  assert.match(html, PROJECT_NAME_RE);
  assert.match(html, PROJECT_DESCRIPTION_RE);
  assert.match(html, PROJECT_DESCRIPTION_LAYOUT_RE);
  assert.match(html, PROJECT_ROW_DESCRIPTION_PADDING_RE);
});

test("project explorer item keeps compact bottom padding without Project Description", () => {
  const html = renderToStaticMarkup(
    createElement(
      ProjectExplorerRoot,
      {
        actions: { onProjectUpdate: () => undefined },
        states: { projects: [] },
      },
      createElement(ProjectExplorerListItem, {
        project: {
          createdAt: "2026-05-26T00:00:00.000Z",
          description: "",
          id: "project-1",
          name: "orders-api",
        },
      })
    )
  );

  assert.match(html, PROJECT_ROW_COMPACT_PADDING_RE);
  assert.match(html, PROJECT_ROW_COMPACT_CENTER_RE);
  assert.doesNotMatch(html, PROJECT_ROW_DESCRIPTION_PADDING_RE);
  assert.doesNotMatch(html, PROJECT_STATUS_DOT_TOP_OFFSET_RE);
});
