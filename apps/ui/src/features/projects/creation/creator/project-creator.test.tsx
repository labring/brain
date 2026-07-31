import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectCreator } from "./project-creator";

const TRAIL_BACK_RE = />Back</;
const DOCKER_DEPLOYER_RE = /data-slot="docker-deployer-fields"/;
const DOCKER_IMAGE_RE = /Docker image/;
const PROJECT_NAME_RE = /Project Name/;
const DESCRIPTION_RE = /Description/;
const DESCRIPTION_BACKSTOP_RE = /maxLength="1024"/;
const DESCRIPTION_HEIGHT_CAP_RE = /max-h-\[7\.25rem\]/;
const DESCRIPTION_OVER_LIMIT_RE = /257\/256/;
const DESCRIPTION_OVER_LIMIT_TONE_RE = /text-destructive/;
const DESCRIPTION_OVER_LIMIT_MESSAGE_RE =
  /Project description must be 256 characters or fewer\./;

function noop() {
  return undefined;
}

test("project creator variant shows selected settings without the step back trail", () => {
  const html = renderToStaticMarkup(
    <ProjectCreator.Root initialStep="docker-image">
      <ProjectCreator.Variant1 />
    </ProjectCreator.Root>
  );

  assert.match(html, DOCKER_DEPLOYER_RE);
  assert.match(html, DOCKER_IMAGE_RE);
  assert.doesNotMatch(html, TRAIL_BACK_RE);
});

test("project creator general step hides project details", () => {
  const html = renderToStaticMarkup(
    <ProjectCreator.Root>
      <ProjectCreator.Variant1 />
    </ProjectCreator.Root>
  );

  assert.doesNotMatch(html, PROJECT_NAME_RE);
  assert.doesNotMatch(html, DESCRIPTION_RE);
});

test("project creator description field warns on soft over-limit drafts", () => {
  const html = renderToStaticMarkup(
    <ProjectCreator.Context.Provider
      value={{
        actions: {
          pick: noop,
          reset: noop,
          setProjectDescription: noop,
          validateProjectDescription() {
            return "Project description must be 256 characters or fewer.";
          },
        },
        meta: {
          databaseDirect: false,
          databaseOptions: [],
          dockerDirect: false,
          enabledSources: [],
          templateDirect: false,
          templateOptions: [],
          templateOptionsLoading: false,
        },
        states: {
          confirmApplying: false,
          projectDescription: "x".repeat(257),
          projectDescriptionError:
            "Project description must be 256 characters or fewer.",
          step: null,
        },
      }}
    >
      <ProjectCreator.ProjectDescriptionField />
    </ProjectCreator.Context.Provider>
  );

  assert.match(html, DESCRIPTION_BACKSTOP_RE);
  assert.match(html, DESCRIPTION_HEIGHT_CAP_RE);
  assert.match(html, DESCRIPTION_OVER_LIMIT_RE);
  assert.match(html, DESCRIPTION_OVER_LIMIT_TONE_RE);
  assert.match(html, DESCRIPTION_OVER_LIMIT_MESSAGE_RE);
});
