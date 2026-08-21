import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DOCKER_APP_LISTENING_PORT,
  normalizeDockerDeploymentSettings,
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

test("Docker deployment settings validate the raw source when present", () => {
  const result = validateDockerDeploymentSettings({
    appListeningPort: 80,
    env: [],
    envRawSource: "# flags\nPORT=8080\nPORT=9090\nbroken line",
    image: "nginx:latest",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.errors.map((error) => ({
      field: error.field,
      index: error.index,
      line: error.line,
      type: error.type,
    })),
    [
      { field: "env", index: 1, line: 3, type: "duplicate-env-name" },
      { field: "env", index: undefined, line: 4, type: "invalid-env-syntax" },
    ]
  );
});

test("Docker deployment settings reject reference expressions at deploy time", () => {
  const result = validateDockerDeploymentSettings({
    appListeningPort: 80,
    env: [],
    envRawSource: ["DATABASE_URL=$", "{{orders-db.DATABASE_URL}}"].join(""),
    image: "nginx:latest",
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.type, "unsupported-env-reference");
  assert.equal(result.errors[0]?.index, 0);
});

test("normalizeDockerDeploymentSettings derives env rows from the raw source", () => {
  const envRawSource = '# flags\nPORT=8080\n\nGREETING="hello world"';
  const normalized = normalizeDockerDeploymentSettings({
    appListeningPort: 80,
    env: [{ name: "STALE", value: "ignored" }],
    envRawSource,
    image: " nginx:latest ",
  });

  assert.equal(normalized.envRawSource, envRawSource);
  assert.deepEqual(normalized.env, [
    { name: "PORT", value: "8080" },
    { name: "GREETING", value: "hello world" },
  ]);
});

test("normalizeDockerDeploymentSettings serializes a raw source for legacy row-only settings", () => {
  const normalized = normalizeDockerDeploymentSettings({
    appListeningPort: 80,
    env: [{ name: "PORT", value: "8080" }],
    image: "nginx:latest",
  });

  assert.equal(normalized.envRawSource, "PORT=8080");
  assert.deepEqual(normalized.env, [{ name: "PORT", value: "8080" }]);
});
