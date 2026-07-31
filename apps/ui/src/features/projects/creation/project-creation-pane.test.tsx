import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react/pure";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  actAndDrain,
  installTestDom,
  restoreActEnvironment,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import { ProjectCreationPane } from "./project-creation-pane";

const noop = () => {
  /* test noop */
};

const ASIDE_RE = /<aside/;
const BUSY_RE = /aria-busy="true"/;
const CLOSE_LABEL_RE = /aria-label="Close project creation pane"/;
const DESCRIPTION_FIELD_RE = /Description/;
const DESCRIPTION_RE = /Select the project creation method/;
const DIALOG_OVERLAY_RE = /data-slot="dialog-overlay"/;
const DIALOG_ROLE_RE = /role="dialog"/;
const DOCKER_IMAGE_RE = /Docker image/;
const AUTO_GENERATED_PUBLIC_ADDRESS_RE = /Auto-generated Public Address/;
const PANE_LABEL_RE = /aria-label="Project creation pane"/;
const PROJECT_NAME_RE = /Project Name/;
const PROJECT_TITLE_RE = /Create New Project/;
const GITHUB_IMPORT_RE = /GitHub Import/;
const GITHUB_IMPORT_DESCRIPTION_RE =
  /Import repository from URL or GitHub authorization\./;
const GITHUB_ACCOUNT_RE = /GitHub Account/;
const GITHUB_CONNECTED_RE = /GitHub connected/i;
const GITHUB_REPO_CARD_RE = /data-slot="github-deployer-repo-card"/;
const GITHUB_SEARCH_RE = /placeholder="Search"/;
const GITHUB_URL_INPUT_RE = /data-slot="github-deployer-url-input"/;
const GITHUB_AUTHORIZE_RE = /Authorize GitHub/;
const GITHUB_REPOSITORY_URL_RE = /Repository URL/;
const GITHUB_REPOSITORY_LOCKED_RE =
  /Please authorize your GitHub account to deploy from a GitHub repository URL\./;
const SCENARIO_RE = /Scenario/;
const TWO_COLUMN_PICKER_RE = /sm:grid-cols-2/;
const TRAIL_BACK_RE = />Back</;
const DATABASE_DEPLOYER_RE = /data-slot="database-deployer-fields"/;
const DATABASE_ICON_RE = /lucide-database/;
const DOCKER_DEPLOYER_RE = /data-slot="docker-deployer-fields"/;
const DOCKER_TITLE_RE = /<title>Docker<\/title>/;
const GITHUB_TITLE_RE = /<title>GitHub<\/title>/;
const PLUS_ICON_RE = /lucide-plus/;

function sidePaneHeader(html: string): string {
  const start = html.indexOf("<header");
  const end = html.indexOf("</header>");
  assert.notEqual(start, -1, "side pane header start is present");
  assert.notEqual(end, -1, "side pane header end is present");
  return html.slice(start, end);
}

test("project creation pane is a non-modal side pane with the method picker", () => {
  const html = renderToStaticMarkup(
    <ProjectCreationPane
      busy
      creatorRootProps={{ databaseOptions: [] }}
      onClose={noop}
      resetKey={1}
    />
  );
  const header = sidePaneHeader(html);

  assert.match(html, ASIDE_RE);
  assert.match(html, PANE_LABEL_RE);
  assert.match(html, BUSY_RE);
  assert.match(html, PROJECT_TITLE_RE);
  assert.match(html, DESCRIPTION_RE);
  assert.match(header, PLUS_ICON_RE);
  assert.doesNotMatch(header, GITHUB_TITLE_RE);
  assert.doesNotMatch(header, DOCKER_TITLE_RE);
  assert.doesNotMatch(html, PROJECT_NAME_RE);
  assert.match(html, CLOSE_LABEL_RE);
  assert.doesNotMatch(html, DIALOG_ROLE_RE);
  assert.doesNotMatch(html, DIALOG_OVERLAY_RE);
  assert.doesNotMatch(html, DESCRIPTION_FIELD_RE);
  assert.doesNotMatch(html, SCENARIO_RE);
  assert.doesNotMatch(html, TWO_COLUMN_PICKER_RE);

  const github = html.indexOf("GitHub");
  const docker = html.indexOf("Docker Image");
  const database = html.indexOf("Database");

  assert.ok(github !== -1, "GitHub method is visible");
  assert.ok(docker !== -1, "Docker Image method is visible");
  assert.ok(database !== -1, "Database method is visible");
  assert.ok(github < docker, "GitHub appears before Docker Image");
  assert.ok(docker < database, "Docker Image appears before Database");
});

test("project creation pane GitHub direct entry starts at repository selection", () => {
  const html = renderToStaticMarkup(
    <ProjectCreationPane
      creatorRootProps={{
        databaseOptions: [],
        githubDeployer: {
          states: {
            deployedRepo: null,
            isAuthorized: true,
            isLoading: false,
            repos: [
              {
                fullName: "acme/api",
                id: "repo-1",
                name: "api",
              },
            ],
          },
        },
      }}
      entryMode="githubDirect"
      onClose={noop}
      resetKey={1}
    />
  );
  const header = sidePaneHeader(html);

  assert.match(html, PANE_LABEL_RE);
  assert.match(header, GITHUB_TITLE_RE);
  assert.doesNotMatch(header, PLUS_ICON_RE);
  assert.match(header, GITHUB_IMPORT_RE);
  assert.doesNotMatch(header, PROJECT_TITLE_RE);
  assert.match(html, GITHUB_IMPORT_DESCRIPTION_RE);
  assert.match(html, GITHUB_CONNECTED_RE);
  assert.match(html, GITHUB_SEARCH_RE);
  assert.match(html, GITHUB_REPO_CARD_RE);
  assert.match(html, GITHUB_URL_INPUT_RE);
  assert.doesNotMatch(html, PROJECT_NAME_RE);
  assert.doesNotMatch(html, SCENARIO_RE);
  assert.doesNotMatch(html, TRAIL_BACK_RE);
});

test("project creation pane GitHub direct entry asks for authorization before URL input", () => {
  const html = renderToStaticMarkup(
    <ProjectCreationPane
      creatorRootProps={{
        databaseOptions: [],
        githubDeployer: {
          actions: { onAuthorize: noop },
          states: {
            deployedRepo: null,
            isAuthorized: false,
            isLoading: false,
            repos: [],
          },
        },
      }}
      entryMode="githubDirect"
      onClose={noop}
      resetKey={1}
    />
  );
  const header = sidePaneHeader(html);

  assert.match(header, GITHUB_TITLE_RE);
  assert.match(header, GITHUB_IMPORT_RE);
  assert.doesNotMatch(header, PROJECT_TITLE_RE);
  assert.match(html, GITHUB_ACCOUNT_RE);
  assert.match(html, GITHUB_REPOSITORY_URL_RE);
  assert.match(html, GITHUB_REPOSITORY_LOCKED_RE);
  assert.match(html, GITHUB_AUTHORIZE_RE);
  assert.doesNotMatch(html, GITHUB_URL_INPUT_RE);
  assert.doesNotMatch(html, GITHUB_SEARCH_RE);
});

test("project creation pane Database direct entry opens deployment settings without generic project naming first", () => {
  const html = renderToStaticMarkup(
    <ProjectCreationPane
      creatorRootProps={{ databaseOptions: [] }}
      entryMode="databaseDirect"
      onClose={noop}
      resetKey={1}
    />
  );
  const header = sidePaneHeader(html);

  assert.match(html, PANE_LABEL_RE);
  assert.match(header, DATABASE_ICON_RE);
  assert.doesNotMatch(header, PLUS_ICON_RE);
  assert.match(html, DATABASE_DEPLOYER_RE);
  assert.doesNotMatch(html, PROJECT_NAME_RE);
  assert.doesNotMatch(html, SCENARIO_RE);
  assert.doesNotMatch(html, TRAIL_BACK_RE);
});

async function withMountedCreationPane(
  element: ReactElement,
  run: (rendered: ReturnType<typeof render>) => Promise<void> | void
) {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await actAndDrain(() => {
      rendered = render(element);
    });
    assert.ok(rendered);
    await run(rendered);
  } finally {
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
}

function creationPaneFooter(container: HTMLElement) {
  return container.querySelector('[data-slot="side-pane-footer"]');
}

test("project creation pane pins the Docker step's submit in the side pane footer", async () => {
  await withMountedCreationPane(
    <ProjectCreationPane
      creatorRootProps={{ databaseOptions: [] }}
      entryMode="dockerDirect"
      onClose={noop}
      resetKey={1}
    />,
    ({ container }) => {
      const footer = creationPaneFooter(container);
      assert.ok(footer, "the active step's submit should pin in the footer");
      assert.ok(
        footer.querySelector('button[aria-label="Deploy Docker image"]'),
        "the pinned action is the Docker deploy submit"
      );
      assert.equal(
        footer.closest(".overflow-y-auto"),
        null,
        "the footer stays outside the scroll container"
      );
      assert.equal(
        container.querySelector(
          '[data-slot="docker-deployer-fields"] button[aria-label="Deploy Docker image"]'
        ),
        null,
        "the submit no longer renders inline inside the form"
      );
    }
  );
});

test("project creation pane source picker contributes no footer", async () => {
  await withMountedCreationPane(
    <ProjectCreationPane
      creatorRootProps={{ databaseOptions: [] }}
      onClose={noop}
      resetKey={1}
    />,
    ({ container }) => {
      assert.equal(creationPaneFooter(container), null);
    }
  );
});

test("project creation pane GitHub step contributes no footer", async () => {
  await withMountedCreationPane(
    <ProjectCreationPane
      creatorRootProps={{
        databaseOptions: [],
        githubDeployer: {
          actions: { onAuthorize: noop },
          states: {
            deployedRepo: null,
            isAuthorized: false,
            isLoading: false,
            repos: [],
          },
        },
      }}
      entryMode="githubDirect"
      onClose={noop}
      resetKey={1}
    />,
    ({ container }) => {
      assert.equal(creationPaneFooter(container), null);
    }
  );
});

test("project creation pane Docker direct entry opens Docker deployment settings without generic project naming first", () => {
  const html = renderToStaticMarkup(
    <ProjectCreationPane
      creatorRootProps={{ databaseOptions: [] }}
      entryMode="dockerDirect"
      onClose={noop}
      resetKey={1}
    />
  );
  const header = sidePaneHeader(html);

  assert.match(html, PANE_LABEL_RE);
  assert.match(header, DOCKER_TITLE_RE);
  assert.doesNotMatch(header, PLUS_ICON_RE);
  assert.match(html, DOCKER_DEPLOYER_RE);
  assert.match(html, DOCKER_IMAGE_RE);
  assert.match(html, AUTO_GENERATED_PUBLIC_ADDRESS_RE);
  assert.doesNotMatch(html, PROJECT_NAME_RE);
  assert.doesNotMatch(html, SCENARIO_RE);
  assert.doesNotMatch(html, TRAIL_BACK_RE);
});
