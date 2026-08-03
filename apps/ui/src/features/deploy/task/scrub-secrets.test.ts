import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactSummaryWithScrubbedValues,
  SCRUBBED_VALUE_PLACEHOLDER,
  scrubSensitiveJsonValue,
  scrubSensitiveText,
} from "./scrub-secrets";
import {
  isSensitiveDeploymentInput,
  sensitiveArgValues,
  withoutSensitiveArgs,
} from "./sensitive-inputs";

const SECRET = "s3cret-value";
const SECRET_B64 = Buffer.from(SECRET, "utf8").toString("base64");

test("scrubSensitiveText replaces plain and base64 occurrences", () => {
  const yaml = [
    `password: ${SECRET}`,
    "data:",
    `  PASSWORD: ${SECRET_B64}`,
    "keep: untouched",
  ].join("\n");
  const scrubbed = scrubSensitiveText(yaml, [SECRET]);
  assert.ok(!scrubbed.includes(SECRET));
  assert.ok(!scrubbed.includes(SECRET_B64));
  assert.ok(scrubbed.includes(SCRUBBED_VALUE_PLACEHOLDER));
  assert.ok(scrubbed.includes("keep: untouched"));
});

test("artifactSummaryWithScrubbedValues scrubs every display copy", () => {
  const summary = artifactSummaryWithScrubbedValues(
    {
      notes: `created ${SECRET}`,
      resources: [
        {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name: `app-${SECRET}`,
          namespace: "ns-demo",
        },
      ],
      resourceYamls: [`stringData:\n  DB_PASSWORD: ${SECRET}`],
    },
    [SECRET]
  );
  assert.ok(!JSON.stringify(summary).includes(SECRET));
  assert.equal(summary.notes, `created ${SCRUBBED_VALUE_PLACEHOLDER}`);
});

test("artifactSummaryWithScrubbedValues is identity without values", () => {
  const summary = { notes: "unchanged" };
  assert.equal(artifactSummaryWithScrubbedValues(summary, []), summary);
});

test("scrubSensitiveJsonValue scrubs nested strings incl. escaped forms", () => {
  const quoted = 'pa"ss-word-1';
  const scrubbed = scrubSensitiveJsonValue(
    {
      buildResult: { log: `login with ${quoted} succeeded` },
      data: SECRET_B64,
      nested: [{ note: `uses ${SECRET}` }],
    },
    [SECRET, quoted]
  );
  const text = JSON.stringify(scrubbed);
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes(SECRET_B64));
  assert.ok(!text.includes("ss-word-1"));
  assert.ok(text.includes(SCRUBBED_VALUE_PLACEHOLDER));
});

test("scrubSensitiveJsonValue never rewrites JSON primitive structure", () => {
  assert.deepEqual(
    scrubSensitiveJsonValue(
      {
        enabled: true,
        nested: { empty: null, secret: "true" },
        count: 10,
      },
      ["true", "null", "10"]
    ),
    {
      enabled: true,
      nested: { empty: null, secret: SCRUBBED_VALUE_PLACEHOLDER },
      count: 10,
    }
  );
});

test("withoutSensitiveArgs drops declared and name-heuristic fields", () => {
  assert.deepEqual(
    withoutSensitiveArgs(
      {
        ADMIN_PASSWORD: "x",
        api_token: "y",
        custom_field: "z",
        mode: "fast",
      },
      [{ key: "custom_field", sensitive: true }]
    ),
    { mode: "fast" }
  );
});

test("sensitiveArgValues collects sensitive values, skipping short ones", () => {
  assert.deepEqual(
    sensitiveArgValues({ DB_PASSWORD: "abc", SIGNING_KEY: SECRET }),
    [SECRET]
  );
});

test("isSensitiveDeploymentInput matches declarations, types, and names", () => {
  assert.ok(isSensitiveDeploymentInput({ key: "anything", sensitive: true }));
  assert.ok(isSensitiveDeploymentInput({ key: "value", type: "password" }));
  assert.ok(isSensitiveDeploymentInput({ key: "value", type: "secret" }));
  assert.ok(isSensitiveDeploymentInput({ key: "ADMIN_PASSWORD" }));
  assert.ok(isSensitiveDeploymentInput({ key: "client_secret" }));
  assert.ok(isSensitiveDeploymentInput({ key: "signing_key" }));
  assert.ok(isSensitiveDeploymentInput({ key: "github_token" }));
  assert.ok(!isSensitiveDeploymentInput({ key: "mode", type: "string" }));
});
