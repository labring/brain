import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveApDisplayName,
  resolveDbDisplayName,
  resourceDisplayNameMergePatch,
  uniqueResourceDisplayName,
  validateResourceDisplayNameRename,
} from "./resource-display-name";

test("setting a display name patches only the annotation", () => {
  assert.deepEqual(resourceDisplayNameMergePatch("My Service"), {
    metadata: {
      annotations: { "brain.io/display-name": "My Service" },
    },
  });
});

test("clearing a display name deletes the annotation key", () => {
  assert.deepEqual(resourceDisplayNameMergePatch(null), {
    metadata: {
      annotations: { "brain.io/display-name": null },
    },
  });
});

test("annotation wins over every derived candidate", () => {
  assert.equal(
    resolveApDisplayName({
      annotations: { "brain.io/display-name": "My Service" },
      image: "ghcr.io/org/nginx:1.27",
      kubernetesName: "nginx-xkqjzw",
      labels: { "brain.io/template-name": "memos" },
    }),
    "My Service"
  );
});

test("annotation values are trimmed before use", () => {
  assert.equal(
    resolveApDisplayName({
      annotations: { "brain.io/display-name": "  padded  " },
      kubernetesName: "ap-xkqjzw",
    }),
    "padded"
  );
});

test("blank annotation falls through to derivation", () => {
  assert.equal(
    resolveApDisplayName({
      annotations: { "brain.io/display-name": "   " },
      image: "nginx:1.27",
      kubernetesName: "ap-xkqjzw",
    }),
    "nginx"
  );
});

test("ap without annotation derives from the docker image segment", () => {
  assert.equal(
    resolveApDisplayName({
      image: "ghcr.io/org/my-api@sha256:abc",
      kubernetesName: "ap-xkqjzw",
    }),
    "my-api"
  );
});

test("template-name label outranks the image for aps", () => {
  assert.equal(
    resolveApDisplayName({
      image: "ghcr.io/usememos/memos:latest",
      kubernetesName: "memos-xkqjzw",
      labels: { "brain.io/template-name": "moememos" },
    }),
    "moememos"
  );
});

test("ap with nothing derivable falls back to the kubernetes name", () => {
  assert.equal(
    resolveApDisplayName({ kubernetesName: "ap-xkqjzw" }),
    "ap-xkqjzw"
  );
  assert.equal(
    resolveApDisplayName({ image: "———", kubernetesName: "ap-xkqjzw" }),
    "ap-xkqjzw"
  );
});

test("db without annotation derives from the engine, lowercased", () => {
  assert.equal(
    resolveDbDisplayName({
      engine: "PostgreSQL",
      kubernetesName: "db-mzpqrt",
    }),
    "postgresql"
  );
});

test("db engine outranks the template-name label", () => {
  assert.equal(
    resolveDbDisplayName({
      engine: "postgresql",
      kubernetesName: "memos-db-abcdef",
      labels: { "brain.io/template-name": "memos" },
    }),
    "postgresql"
  );
});

test("template db without engine derives from the template-name label", () => {
  assert.equal(
    resolveDbDisplayName({
      kubernetesName: "memos-db-abcdef",
      labels: { "brain.io/template-name": "memos" },
    }),
    "memos"
  );
});

test("db with nothing derivable falls back to the kubernetes name", () => {
  assert.equal(
    resolveDbDisplayName({ kubernetesName: "db-mzpqrt" }),
    "db-mzpqrt"
  );
});

test("a free base name is kept bare", () => {
  assert.equal(uniqueResourceDisplayName("nginx", ["postgresql"]), "nginx");
});

test("a taken base name numbers from 2 upward", () => {
  assert.equal(uniqueResourceDisplayName("nginx", ["nginx"]), "nginx-2");
  assert.equal(
    uniqueResourceDisplayName("nginx", ["nginx", "nginx-2"]),
    "nginx-3"
  );
});

test("numbering compares names case-insensitively", () => {
  assert.equal(uniqueResourceDisplayName("nginx", ["Nginx"]), "nginx-2");
});

test("numbering skips over holes left by renames", () => {
  assert.equal(
    uniqueResourceDisplayName("nginx", ["nginx", "nginx-3"]),
    "nginx-2"
  );
});

test("a rename to a fresh name is accepted trimmed", () => {
  assert.deepEqual(
    validateResourceDisplayNameRename({
      takenNames: ["postgresql"],
      value: "  My 服务 🚀  ",
    }),
    { kind: "set", value: "My 服务 🚀" }
  );
});

test("clearing the title restores the derived default", () => {
  assert.deepEqual(
    validateResourceDisplayNameRename({ takenNames: [], value: "   " }),
    { kind: "clear" }
  );
});

test("a rename onto a project sibling is rejected", () => {
  assert.deepEqual(
    validateResourceDisplayNameRename({
      takenNames: ["nginx"],
      value: "Nginx",
    }),
    { kind: "invalid", reason: "duplicate" }
  );
});

test("an overlong rename is rejected, not truncated", () => {
  assert.deepEqual(
    validateResourceDisplayNameRename({
      takenNames: [],
      value: "x".repeat(257),
    }),
    { kind: "invalid", reason: "too-long" }
  );
  assert.deepEqual(
    validateResourceDisplayNameRename({
      takenNames: [],
      value: "x".repeat(256),
    }),
    { kind: "set", value: "x".repeat(256) }
  );
});

test("an overlong annotation is bounded like a derived name", () => {
  const name = `nginx${"x".repeat(400)}`;
  const resolved = resolveApDisplayName({
    annotations: { "brain.io/display-name": name },
    kubernetesName: "ap-xkqjzw",
  });
  assert.equal(resolved.length, 256);
  assert.equal(resolved, name.slice(0, 256));
});
