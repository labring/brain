import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectCreator } from "./project-creator";

const TRAIL_BACK_RE = />Back</;
const DOCKER_DEPLOYER_RE = /data-slot="docker-deployer"/;
const DOCKER_IMAGE_RE = /Docker image/;
const PROJECT_NAME_RE = /Project Name/;
const DESCRIPTION_RE = /Description/;
const DESCRIPTION_COUNT_RE = /0\/256/;

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

test("project creator general step includes Project Description", () => {
  const html = renderToStaticMarkup(
    <ProjectCreator.Root>
      <ProjectCreator.Variant1 />
    </ProjectCreator.Root>
  );

  assert.match(html, PROJECT_NAME_RE);
  assert.match(html, DESCRIPTION_RE);
  assert.match(html, DESCRIPTION_COUNT_RE);
});
