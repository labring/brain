import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeploymentTaskSource } from "@/features/deploy/task/schema";
import {
  derivedProjectDisplayNameBase,
  deriveProjectDisplayName,
  projectDisplayNameWithSuffix,
  randomProjectDisplayName,
} from "./derived-project-display-name";

const RANDOM_DISPLAY_NAME_RE = /^[a-z]+-[a-z]+$/;

function dockerSource(image: unknown): DeploymentTaskSource {
  return { kind: "docker", settings: { image } };
}

test("Docker display names use the final image path segment", () => {
  assert.equal(
    derivedProjectDisplayNameBase(dockerSource("nginx:1.27")),
    "nginx"
  );
  assert.equal(
    derivedProjectDisplayNameBase(dockerSource("ghcr.io/acme/api:1.2")),
    "api"
  );
  assert.equal(
    derivedProjectDisplayNameBase(dockerSource("ghcr.io/acme/team/my-api:1.2")),
    "my-api"
  );
});

test("Docker display names strip digests and registry ports", () => {
  assert.equal(
    derivedProjectDisplayNameBase(
      dockerSource("ghcr.io/org/my-api@sha256:0123456789abcdef")
    ),
    "my-api"
  );
  assert.equal(
    derivedProjectDisplayNameBase(dockerSource("localhost:5000/app:1")),
    "app"
  );
  assert.equal(
    derivedProjectDisplayNameBase(dockerSource("localhost:5000/app")),
    "app"
  );
});

test("Docker display names are absent when nothing usable survives stripping", () => {
  assert.equal(derivedProjectDisplayNameBase(dockerSource("   ")), null);
  assert.equal(
    derivedProjectDisplayNameBase(dockerSource("ghcr.io/acme/:1")),
    null
  );
  assert.equal(derivedProjectDisplayNameBase(dockerSource("---")), null);
  assert.equal(derivedProjectDisplayNameBase(dockerSource(42)), null);
});

test("Docker display names are bounded so a pathological image ref cannot fill the list", () => {
  const derived = derivedProjectDisplayNameBase(dockerSource("a".repeat(400)));
  assert.equal(derived, "a".repeat(128));
});

test("Docker display names are absent when nothing readable survives the bound", () => {
  // The only readable character sits past the cap, so truncating would leave
  // a row of punctuation behind.
  assert.equal(
    derivedProjectDisplayNameBase(dockerSource(`${"-".repeat(200)}a`)),
    null
  );
});

test("GitHub display names use the repository name with its case preserved", () => {
  const source: DeploymentTaskSource = {
    kind: "github",
    repo: {
      fullName: "acme/My-API",
      name: "My-API",
      url: "https://github.com/acme/My-API",
    },
  };
  assert.equal(derivedProjectDisplayNameBase(source), "My-API");
});

test("Database display names use the lowercase engine id of the selected option", () => {
  assert.equal(
    derivedProjectDisplayNameBase({
      kind: "database",
      settings: { databaseId: "postgresql", instancePreset: "xs", replicas: 1 },
    }),
    "postgresql"
  );
  assert.equal(
    derivedProjectDisplayNameBase({
      kind: "database",
      settings: { databaseId: "mongodb" },
    }),
    "mongodb"
  );
});

test("Database display names are absent for an unknown engine id", () => {
  assert.equal(
    derivedProjectDisplayNameBase({
      kind: "database",
      settings: { databaseId: "cassandra" },
    }),
    null
  );
});

test("Template display names use the template name verbatim", () => {
  assert.equal(
    derivedProjectDisplayNameBase({
      kind: "template",
      templateName: "Flowise",
    }),
    "Flowise"
  );
});

test("Prompt sources yield no derived display name", () => {
  assert.equal(
    derivedProjectDisplayNameBase({ kind: "prompt", text: "deploy a blog" }),
    null
  );
});

test("Derivation falls back to a readable random name", () => {
  assert.match(
    deriveProjectDisplayName({ kind: "prompt", text: "deploy a blog" }),
    RANDOM_DISPLAY_NAME_RE
  );
  assert.match(
    deriveProjectDisplayName(dockerSource("   ")),
    RANDOM_DISPLAY_NAME_RE
  );
  assert.match(randomProjectDisplayName(), RANDOM_DISPLAY_NAME_RE);
});

test("Derivation returns the derived name when the source yields one", () => {
  assert.equal(deriveProjectDisplayName(dockerSource("nginx:1.27")), "nginx");
});

test("Suffixes start at the bare name and increment from two", () => {
  assert.equal(projectDisplayNameWithSuffix("nginx", 1), "nginx");
  assert.equal(projectDisplayNameWithSuffix("nginx", 2), "nginx-2");
  assert.equal(projectDisplayNameWithSuffix("nginx", 3), "nginx-3");
});
