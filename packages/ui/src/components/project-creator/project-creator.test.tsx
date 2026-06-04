import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectCreator } from "./project-creator";

const TRAIL_BACK_RE = />Back</;
const DOCKER_DEPLOYER_RE = /data-slot="docker-deployer"/;
const DOCKER_IMAGE_RE = /Docker image/;

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
