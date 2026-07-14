import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveDockerProjectDisplayName } from "./docker-project-display-name";

test("Docker project display name uses the final repository segment", () => {
  assert.equal(
    deriveDockerProjectDisplayName({
      existingProjectDisplayNames: [],
      imageRef: "ghcr.io/acme/api:1.2",
    }),
    "api"
  );
});

test("Docker project display name handles single-name and digest image refs", () => {
  assert.equal(
    deriveDockerProjectDisplayName({
      existingProjectDisplayNames: [],
      imageRef: "nginx:latest",
    }),
    "nginx"
  );
  assert.equal(
    deriveDockerProjectDisplayName({
      existingProjectDisplayNames: [],
      imageRef: "registry/foo/bar@sha256:abc123",
    }),
    "bar"
  );
});

test("Docker project display name falls back when no usable repository segment exists", () => {
  assert.equal(
    deriveDockerProjectDisplayName({
      existingProjectDisplayNames: ["Docker Project"],
      imageRef: "  ",
    }),
    "Docker Project-2"
  );
});

test("Docker project display name avoids case-insensitive repeated conflicts", () => {
  assert.equal(
    deriveDockerProjectDisplayName({
      existingProjectDisplayNames: ["API", "api-2", "api-3"],
      imageRef: "ghcr.io/acme/api:1.2",
    }),
    "api-4"
  );
});
