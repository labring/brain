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
const PROJECT_EMPTY_DESCRIPTION_SCREEN_RE =
  /<span aria-hidden="true">-<\/span>/;
const PROJECT_EMPTY_DESCRIPTION_SR_RE =
  /<span class="sr-only">No project description<\/span>/;
const PROJECT_DESCRIPTION_LAYOUT_RE =
  /<p class="[^"]*\bcol-span-full\b[^"]*\brow-start-2\b[^"]*"/;
const PROJECT_ROW_DESCRIPTION_PADDING_RE =
  /<div class="[^"]*\bproject-explorer-item-row\b[^"]* pb-\[18px\][^"]*"/;
const PROJECT_EMPTY_DESCRIPTION_TONE_RE =
  /<p class="[^"]*\btext-muted-foreground\/45\b[^"]*"/;
const PROJECT_PIN_ACTION_RE = /aria-label="Pin orders-api"/;
const PROJECT_UNPIN_ACTION_RE = /aria-label="Unpin orders-api"/;
const PROJECT_PIN_PRESSED_RE = /aria-pressed="true"/;
const PROJECT_PIN_DISABLED_RE = /disabled=""/;

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

test("project explorer item renders a lightweight empty Project Description state", () => {
  const html = renderToStaticMarkup(
    createElement(
      ProjectExplorerRoot,
      {
        actions: {
          onProjectClick: () => undefined,
          onProjectUpdate: () => undefined,
        },
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

  assert.match(html, PROJECT_EMPTY_DESCRIPTION_SCREEN_RE);
  assert.match(html, PROJECT_EMPTY_DESCRIPTION_SR_RE);
  assert.match(html, PROJECT_DESCRIPTION_LAYOUT_RE);
  assert.match(html, PROJECT_ROW_DESCRIPTION_PADDING_RE);
  assert.match(html, PROJECT_EMPTY_DESCRIPTION_TONE_RE);
});

test("project explorer item renders a pin action when pinning is available", () => {
  const html = renderToStaticMarkup(
    createElement(
      ProjectExplorerRoot,
      {
        actions: { onProjectPinToggle: () => undefined },
        states: { pinnedProjectIds: [], pinnedProjectLimit: 8, projects: [] },
      },
      createElement(ProjectExplorerListItem, {
        project: {
          createdAt: "2026-05-26T00:00:00.000Z",
          id: "project-1",
          name: "orders-api",
        },
      })
    )
  );

  assert.match(html, PROJECT_PIN_ACTION_RE);
});

test("project explorer item renders unpin state for Pinned Projects", () => {
  const html = renderToStaticMarkup(
    createElement(
      ProjectExplorerRoot,
      {
        actions: { onProjectPinToggle: () => undefined },
        states: {
          pinnedProjectIds: ["project-1"],
          pinnedProjectLimit: 8,
          projects: [],
        },
      },
      createElement(ProjectExplorerListItem, {
        project: {
          createdAt: "2026-05-26T00:00:00.000Z",
          id: "project-1",
          name: "orders-api",
        },
      })
    )
  );

  assert.match(html, PROJECT_UNPIN_ACTION_RE);
  assert.match(html, PROJECT_PIN_PRESSED_RE);
});

test("project explorer item disables pinning when the limit is reached", () => {
  const html = renderToStaticMarkup(
    createElement(
      ProjectExplorerRoot,
      {
        actions: { onProjectPinToggle: () => undefined },
        states: {
          pinnedProjectIds: Array.from(
            { length: 8 },
            (_, index) => `project-${index}`
          ),
          pinnedProjectLimit: 8,
          projects: [],
        },
      },
      createElement(ProjectExplorerListItem, {
        project: {
          createdAt: "2026-05-26T00:00:00.000Z",
          id: "project-overflow",
          name: "orders-api",
        },
      })
    )
  );

  assert.match(html, PROJECT_PIN_ACTION_RE);
  assert.match(html, PROJECT_PIN_DISABLED_RE);
});
