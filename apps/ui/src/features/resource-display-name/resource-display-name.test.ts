import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveResourceDisplayName,
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

test("annotation wins over the kubernetes name", () => {
  assert.equal(
    resolveResourceDisplayName({
      annotations: { "brain.io/display-name": "My Service" },
      kubernetesName: "nginx-xkqjzw",
    }),
    "My Service"
  );
});

test("annotation values are trimmed before use", () => {
  assert.equal(
    resolveResourceDisplayName({
      annotations: { "brain.io/display-name": "  padded  " },
      kubernetesName: "ap-xkqjzw",
    }),
    "padded"
  );
});

test("blank annotation falls back to the kubernetes name", () => {
  assert.equal(
    resolveResourceDisplayName({
      annotations: { "brain.io/display-name": "   " },
      kubernetesName: "ap-xkqjzw",
    }),
    "ap-xkqjzw"
  );
});

test("non-string annotation falls back to the kubernetes name", () => {
  assert.equal(
    resolveResourceDisplayName({
      annotations: { "brain.io/display-name": 42 },
      kubernetesName: "ap-xkqjzw",
    }),
    "ap-xkqjzw"
  );
});

test("resource without the annotation shows the kubernetes name", () => {
  assert.equal(
    resolveResourceDisplayName({ kubernetesName: "ap-xkqjzw" }),
    "ap-xkqjzw"
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

test("an empty rename is a no-op, not a clear", () => {
  assert.deepEqual(
    validateResourceDisplayNameRename({ takenNames: [], value: "   " }),
    { kind: "noop" }
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

test("an overlong annotation is bounded on read", () => {
  const name = `nginx${"x".repeat(400)}`;
  const resolved = resolveResourceDisplayName({
    annotations: { "brain.io/display-name": name },
    kubernetesName: "ap-xkqjzw",
  });
  assert.equal(resolved.length, 256);
  assert.equal(resolved, name.slice(0, 256));
});
