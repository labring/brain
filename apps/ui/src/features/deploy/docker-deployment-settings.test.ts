import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DOCKER_APP_LISTENING_PORT,
  validateDockerDeploymentSettings,
} from "./docker-deployment-settings";

test("Docker deployment settings accept common image refs and default port", () => {
  for (const image of [
    "ghcr.io/acme/api:1.2",
    "nginx:latest",
    "registry/foo/bar@sha256:abc123",
  ]) {
    assert.equal(
      validateDockerDeploymentSettings({
        appListeningPort: DEFAULT_DOCKER_APP_LISTENING_PORT,
        env: [{ name: "FEATURE_FLAG", value: "true" }],
        image,
      }).valid,
      true,
      image
    );
  }
});

test("Docker deployment settings reject empty and whitespace-containing image refs", () => {
  for (const image of ["", "   ", "nginx: latest", "ghcr.io/acme/api tag"]) {
    const result = validateDockerDeploymentSettings({
      appListeningPort: 80,
      env: [],
      image,
    });

    assert.equal(result.valid, false, image);
    assert.equal(
      result.errors.some((error) => error.field === "image"),
      true
    );
  }
});

test("Docker deployment settings reject invalid App Listening Ports", () => {
  for (const appListeningPort of [0, 65_536, 8080.5, Number.NaN]) {
    const result = validateDockerDeploymentSettings({
      appListeningPort,
      env: [],
      image: "nginx:latest",
    });

    assert.equal(result.valid, false, String(appListeningPort));
    assert.equal(
      result.errors.some((error) => error.field === "appListeningPort"),
      true
    );
  }
});

test("Docker deployment settings reject invalid and duplicate env var names", () => {
  const result = validateDockerDeploymentSettings({
    appListeningPort: 80,
    env: [
      { name: "DATABASE_URL", value: "postgres://primary" },
      { name: "1INVALID", value: "bad" },
      { name: "DATABASE_URL", value: "postgres://replica" },
    ],
    image: "nginx:latest",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.errors.map((error) => ({
      field: error.field,
      index: error.index,
      type: error.type,
    })),
    [
      { field: "env", index: 1, type: "invalid-env-name" },
      { field: "env", index: 2, type: "duplicate-env-name" },
    ]
  );
});
