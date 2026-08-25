import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveResourceDisplayName,
  resourceDisplayNameMergePatch,
  templateResourceDisplayNames,
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

test("length is counted in code points, matching the Go API bound", () => {
  assert.deepEqual(
    validateResourceDisplayNameRename({
      takenNames: [],
      value: "😀".repeat(256),
    }),
    { kind: "set", value: "😀".repeat(256) }
  );
  assert.deepEqual(
    validateResourceDisplayNameRename({
      takenNames: [],
      value: "😀".repeat(257),
    }),
    { kind: "invalid", reason: "too-long" }
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

test("the sole AP of a template instance gets the bare template name", () => {
  const names = templateResourceDisplayNames({
    resources: [
      { kind: "ap", kubernetesName: "wordpress" },
      { engine: "mysql", kind: "db", kubernetesName: "wordpress-mysql-x" },
    ],
    takenNames: [],
    templateName: "wordpress",
  });
  assert.deepEqual(
    [...names.entries()],
    [
      ["wordpress", "wordpress"],
      ["wordpress-mysql-x", "wordpress-mysql"],
    ]
  );
});

test("multiple APs all get the template name as prefix", () => {
  const names = templateResourceDisplayNames({
    resources: [
      { kind: "ap", kubernetesName: "frontend" },
      { kind: "ap", kubernetesName: "backend" },
      { engine: "postgresql", kind: "db", kubernetesName: "pg-cluster" },
    ],
    takenNames: [],
    templateName: "appsmith",
  });
  assert.deepEqual(
    [...names.entries()],
    [
      ["frontend", "appsmith-frontend"],
      ["backend", "appsmith-backend"],
      ["pg-cluster", "appsmith-postgresql"],
    ]
  );
});

test("an identifier already carrying the template prefix is not prefixed twice", () => {
  const names = templateResourceDisplayNames({
    resources: [
      { kind: "ap", kubernetesName: "wordpress" },
      { kind: "ap", kubernetesName: "wordpress-cron" },
    ],
    takenNames: [],
    templateName: "wordpress",
  });
  assert.deepEqual(
    [...names.entries()],
    [
      ["wordpress", "wordpress"],
      ["wordpress-cron", "wordpress-cron"],
    ]
  );
});

test("a repeat deployment numbers the whole family from one base", () => {
  const names = templateResourceDisplayNames({
    resources: [
      { kind: "ap", kubernetesName: "wordpress-abcdef" },
      { engine: "mysql", kind: "db", kubernetesName: "wp-mysql-abcdef" },
    ],
    takenNames: ["wordpress", "wordpress-mysql"],
    templateName: "wordpress",
  });
  assert.deepEqual(
    [...names.entries()],
    [
      ["wordpress-abcdef", "wordpress-2"],
      ["wp-mysql-abcdef", "wordpress-2-mysql"],
    ]
  );
});

test("a family collision on any member renumbers the whole family", () => {
  const names = templateResourceDisplayNames({
    resources: [
      { kind: "ap", kubernetesName: "wordpress-abcdef" },
      { engine: "mysql", kind: "db", kubernetesName: "wp-mysql-abcdef" },
    ],
    takenNames: ["wordpress-mysql"],
    templateName: "wordpress",
  });
  assert.deepEqual(
    [...names.entries()],
    [
      ["wordpress-abcdef", "wordpress-2"],
      ["wp-mysql-abcdef", "wordpress-2-mysql"],
    ]
  );
});

test("a DB without a known engine falls back to its kubernetes name as suffix", () => {
  const names = templateResourceDisplayNames({
    resources: [
      { kind: "ap", kubernetesName: "memos" },
      { kind: "db", kubernetesName: "memos-store" },
    ],
    takenNames: [],
    templateName: "memos",
  });
  assert.deepEqual(
    [...names.entries()],
    [
      ["memos", "memos"],
      ["memos-store", "memos-store"],
    ]
  );
});

test("siblings deriving the same candidate are numbered within the family", () => {
  const names = templateResourceDisplayNames({
    resources: [
      { engine: "redis", kind: "db", kubernetesName: "cache-a" },
      { engine: "redis", kind: "db", kubernetesName: "cache-b" },
    ],
    takenNames: [],
    templateName: "chat",
  });
  assert.deepEqual(
    [...names.entries()],
    [
      ["cache-a", "chat-redis"],
      ["cache-b", "chat-redis-2"],
    ]
  );
});

test("template naming is case-insensitive against taken names", () => {
  const names = templateResourceDisplayNames({
    resources: [{ kind: "ap", kubernetesName: "memos-abcdef" }],
    takenNames: ["Memos"],
    templateName: "memos",
  });
  assert.deepEqual([...names.entries()], [["memos-abcdef", "memos-2"]]);
});

test("an empty template name or resource list yields no names", () => {
  assert.equal(
    templateResourceDisplayNames({
      resources: [{ kind: "ap", kubernetesName: "memos" }],
      takenNames: [],
      templateName: "  ",
    }).size,
    0
  );
  assert.equal(
    templateResourceDisplayNames({
      resources: [],
      takenNames: [],
      templateName: "memos",
    }).size,
    0
  );
});
