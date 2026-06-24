import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apPendingTargetForDomain,
  apPendingTargetsForDirtyDomains,
  applyApPendingTargets,
} from "./ap-pending-settings";
import type { ApSettingsDraft } from "./ap-settings-draft";

const POSTGRES_DATABASE_URL_REFERENCE = "{{postgres.DATABASE_URL}}";
const AUTHORED_ENV_RAW_SOURCE = [
  "# keep this comment",
  ["DATABASE_URL=$", POSTGRES_DATABASE_URL_REFERENCE].join(""),
].join("\n");

test("AP pending adapter extracts dirty domains and overlays authored environment raw source", () => {
  const base: ApSettingsDraft = {
    cpuCores: 1,
    env: [{ name: "DATABASE_URL", value: "postgres://old" }],
    envRawSource: "DATABASE_URL=postgres://old",
    image: "ghcr.io/acme/api:v1",
    memoryMib: 512,
    network: { privatePort: 3000, publicAddresses: [] },
  };
  const draft: ApSettingsDraft = {
    ...base,
    envRawSource: AUTHORED_ENV_RAW_SOURCE,
    network: { privatePort: 8080, publicAddresses: [] },
  };

  const targets = apPendingTargetsForDirtyDomains(base, draft);

  assert.deepEqual(Object.keys(targets).sort(), ["environment", "network"]);
  assert.deepEqual(targets.environment, {
    rawSource: AUTHORED_ENV_RAW_SOURCE,
  });
  assert.deepEqual(targets.network, {
    privatePort: 8080,
    publicAddresses: [],
  });

  const effective = applyApPendingTargets(base, targets);
  assert.equal(effective.envRawSource, AUTHORED_ENV_RAW_SOURCE);
  assert.deepEqual(effective.network, {
    privatePort: 8080,
    publicAddresses: [],
  });
  assert.deepEqual(apPendingTargetForDomain("environment", effective), {
    rawSource: AUTHORED_ENV_RAW_SOURCE,
  });
});
