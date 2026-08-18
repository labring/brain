import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ImageUpdateSection } from "./image-update-section";

const APPLYING_BADGE_RE = /Applying changes/;
const DIVERGED_TITLE_RE = /Configuration changed elsewhere/;
const KEEP_TARGET_RE = /Keep my target/;
const USE_LATEST_RE = /Use latest/;
const UPDATE_DISABLED_RE = /disabled=""[^>]*aria-label="Update AP image"/;
const INPUT_DISABLED_RE = /disabled=""[^>]*aria-label="AP image"/;
const OBSERVED_IMAGE_RE = /ghcr\.io\/acme\/api:2\.0\.0/;
const TARGET_IMAGE_RE = /ghcr\.io\/acme\/api:1\.1\.0/;

const noop = () => {
  /* static render */
};

function section(
  overrides: Partial<Parameters<typeof ImageUpdateSection>[0]> = {}
) {
  return renderToStaticMarkup(
    <ImageUpdateSection
      busy={false}
      dirty={false}
      disabled={false}
      onChange={noop}
      onKeepTarget={noop}
      onSubmit={noop}
      onUseLatest={noop}
      status={null}
      value="ghcr.io/acme/api:1.0.0"
      {...overrides}
    />
  );
}

test("image update section keeps Update disabled until the draft is dirty", () => {
  assert.match(section(), UPDATE_DISABLED_RE);
  assert.doesNotMatch(section({ dirty: true }), UPDATE_DISABLED_RE);
});

test("image update section shows the applying badge while a launch update is pending", () => {
  const html = section({
    status: { kind: "applying", targetImage: "ghcr.io/acme/api:1.1.0" },
    value: "ghcr.io/acme/api:1.1.0",
  });

  assert.match(html, APPLYING_BADGE_RE);
  assert.doesNotMatch(html, DIVERGED_TITLE_RE);
});

test("image update section presents the divergence two-way choice inline", () => {
  const html = section({
    status: {
      kind: "diverged",
      observedImage: "ghcr.io/acme/api:2.0.0",
      targetImage: "ghcr.io/acme/api:1.1.0",
    },
  });

  assert.match(html, DIVERGED_TITLE_RE);
  assert.match(html, KEEP_TARGET_RE);
  assert.match(html, USE_LATEST_RE);
  assert.match(html, OBSERVED_IMAGE_RE);
  assert.match(html, TARGET_IMAGE_RE);
});

test("image update section locks editing while diverged until the user chooses", () => {
  const html = section({
    dirty: true,
    status: {
      kind: "diverged",
      observedImage: "ghcr.io/acme/api:2.0.0",
      targetImage: "ghcr.io/acme/api:1.1.0",
    },
  });

  assert.match(html, INPUT_DISABLED_RE);
  assert.match(html, UPDATE_DISABLED_RE);
});
