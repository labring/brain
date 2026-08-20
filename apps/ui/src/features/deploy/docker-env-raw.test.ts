import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendDockerEnvRow,
  DOCKER_ENV_REFERENCE_UNSUPPORTED_MESSAGE,
  dockerEnvCanonicalRawSource,
  dockerEnvRawDiagnostics,
  dockerEnvRowsForSave,
  dockerEnvRowViews,
  patchDockerEnvRow,
  removeDockerEnvRow,
} from "./docker-env-raw";

const SOURCE_WITH_TRIVIA = [
  "# core config",
  "PORT=8080",
  "",
  'GREETING="hello world"',
].join("\n");

test("dockerEnvCanonicalRawSource prefers the stored raw source over rows", () => {
  assert.equal(
    dockerEnvCanonicalRawSource({
      env: [{ name: "PORT", value: "9090" }],
      envRawSource: SOURCE_WITH_TRIVIA,
    }),
    SOURCE_WITH_TRIVIA
  );
});

test("dockerEnvCanonicalRawSource serializes legacy row-only snapshots", () => {
  assert.equal(
    dockerEnvCanonicalRawSource({
      env: [
        { name: "PORT", value: "8080" },
        { name: "FLAG", value: "true" },
      ],
    }),
    "PORT=8080\nFLAG=true"
  );
});

test("dockerEnvRowViews keeps assignment lines and equals-bearing invalid lines", () => {
  const views = dockerEnvRowViews(
    ["# comment", "PORT=8080", "=orphan", "1BAD=x", "not-an-assignment"].join(
      "\n"
    )
  );

  assert.deepEqual(views, [
    { line: 2, name: "PORT", value: "8080" },
    { line: 3, name: "", value: "orphan" },
    { line: 4, name: "1BAD", value: "x" },
  ]);
});

test("patchDockerEnvRow rewrites one line and keeps comments and quoting", () => {
  const renamed = patchDockerEnvRow(SOURCE_WITH_TRIVIA, 2, {
    name: "APP_PORT",
  });
  assert.equal(
    renamed,
    ["# core config", "APP_PORT=8080", "", 'GREETING="hello world"'].join("\n")
  );

  const revalued = patchDockerEnvRow(renamed, 4, { value: "hi there" });
  assert.equal(
    revalued,
    ["# core config", "APP_PORT=8080", "", 'GREETING="hi there"'].join("\n")
  );
});

test("patchDockerEnvRow keeps a row editable while its name is cleared", () => {
  const cleared = patchDockerEnvRow("PORT=8080", 1, { name: "" });

  assert.equal(cleared, "=8080");
  assert.deepEqual(dockerEnvRowViews(cleared), [
    { line: 1, name: "", value: "8080" },
  ]);
  assert.equal(dockerEnvRawDiagnostics(cleared)[0]?.type, "missing-name");

  const restored = patchDockerEnvRow(cleared, 1, { name: "PORT" });
  assert.equal(restored, "PORT=8080");
});

test("removeDockerEnvRow deletes only the targeted line", () => {
  assert.equal(
    removeDockerEnvRow(SOURCE_WITH_TRIVIA, 2),
    ["# core config", "", 'GREETING="hello world"'].join("\n")
  );
});

test("appendDockerEnvRow appends an empty assignment", () => {
  assert.equal(appendDockerEnvRow("", "NEW_VARIABLE"), "NEW_VARIABLE=");
  assert.equal(
    appendDockerEnvRow("PORT=8080", "NEW_VARIABLE"),
    "PORT=8080\nNEW_VARIABLE="
  );
});

test("dockerEnvRowsForSave keeps only valid assignments", () => {
  assert.deepEqual(
    dockerEnvRowsForSave(
      ["# comment", "PORT=8080", "=orphan", 'GREETING="hello world"'].join("\n")
    ),
    [
      { name: "PORT", value: "8080" },
      { name: "GREETING", value: "hello world" },
    ]
  );
});

test("dockerEnvRawDiagnostics flags reference expressions as unsupported", () => {
  const diagnostics = dockerEnvRawDiagnostics(
    ["DATABASE_URL=$", "{{orders-db.DATABASE_URL}}"].join("")
  );

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.type, "unresolved-reference");
  assert.equal(
    diagnostics[0]?.message,
    DOCKER_ENV_REFERENCE_UNSUPPORTED_MESSAGE
  );
});

test("dockerEnvRawDiagnostics reports parser errors before reference checks", () => {
  const diagnostics = dockerEnvRawDiagnostics("no-equals-here");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.type, "syntax");
});
