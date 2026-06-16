import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectExplorerRoot } from "./project-explorer.context";
import { ProjectExplorerList } from "./project-explorer.list";

const PROJECT_LIST_SCROLL_CLASS_RE =
  /<div class="[^"]*\bmin-h-0\b[^"]*\bflex-1\b[^"]*\boverflow-y-auto\b[^"]*" data-slot="project-explorer-list"/;

test("project explorer list owns vertical scrolling inside the explorer shell", () => {
  const html = renderToStaticMarkup(
    createElement(
      ProjectExplorerRoot,
      {
        states: {
          projects: [
            {
              createdAt: "2026-05-26T00:00:00.000Z",
              id: "project-1",
              name: "orders-api",
            },
          ],
        },
      },
      createElement(ProjectExplorerList)
    )
  );

  assert.match(html, PROJECT_LIST_SCROLL_CLASS_RE);
});
