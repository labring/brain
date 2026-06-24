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
    appListeningPorts: [{ port: 8080 }],
    privatePort: 8080,
    publicAddresses: [],
  });

  const effective = applyApPendingTargets(base, targets);
  assert.equal(effective.envRawSource, AUTHORED_ENV_RAW_SOURCE);
  assert.deepEqual(effective.network, {
    appListeningPorts: [{ port: 8080 }],
    privatePort: 8080,
    publicAddresses: [],
  });
  assert.deepEqual(apPendingTargetForDomain("environment", effective), {
    rawSource: AUTHORED_ENV_RAW_SOURCE,
  });
});

test("AP pending adapter ignores network lifecycle status when extracting dirty domains", () => {
  const base: ApSettingsDraft = {
    cpuCores: 1,
    env: [],
    image: "ghcr.io/acme/api:v1",
    memoryMib: 512,
    network: {
      customDomains: [
        {
          cnameTarget: "target.example.dev",
          dns: {
            status: "verified",
            target: "target.example.dev",
            verifiedAt: "2026-06-24T01:00:00.000Z",
          },
          domain: "www.example.com",
          id: "custom-1",
          platformAddressId: "platform-1",
          targetPort: 8080,
        },
      ],
      privatePort: 8080,
      publicAddresses: [{ id: "platform-1", port: 8080 }],
    },
  };
  const baseDomain = base.network.customDomains?.[0];
  assert.ok(baseDomain);
  const draft: ApSettingsDraft = {
    ...base,
    network: {
      ...base.network,
      customDomains: [
        {
          ...baseDomain,
          certificate: { status: "ready" },
          dns: {
            status: "running",
            target: "target.example.dev",
            verifiedAt: "2026-06-24T02:00:00.000Z",
          },
          routing: { status: "ready" },
          status: "running",
        },
      ],
    },
  };

  assert.deepEqual(apPendingTargetsForDirtyDomains(base, draft), {});
});

test("AP pending adapter treats platform address id evidence as the same network target", () => {
  const base: ApSettingsDraft = {
    cpuCores: 1,
    env: [],
    image: "ghcr.io/acme/api:v1",
    memoryMib: 512,
    network: {
      privatePort: 8080,
      publicAddresses: [{ id: "pa_abc123", port: 8080 }],
    },
  };
  const draft: ApSettingsDraft = {
    ...base,
    network: {
      privatePort: 8080,
      publicAddresses: [
        {
          platformAddressId: "pa_abc123",
          port: 8080,
          status: "running",
          url: "https://api.example.com/",
        },
      ],
    },
  };

  assert.deepEqual(apPendingTargetsForDirtyDomains(base, draft), {});
});

test("AP pending adapter stores only saveable network draft fields", () => {
  const base: ApSettingsDraft = {
    cpuCores: 1,
    env: [],
    image: "ghcr.io/acme/api:v1",
    memoryMib: 512,
    network: {
      privatePort: 8080,
      publicAddresses: [],
    },
  };
  const draft: ApSettingsDraft = {
    ...base,
    network: {
      appListeningPorts: [{ privateAddress: "http://api:8080", port: 8080 }],
      customDomains: [
        {
          certificate: { status: "ready" },
          cnameTarget: "api.example.dev",
          dns: {
            status: "verified",
            target: "api.example.dev",
            verifiedAt: "2026-06-24T01:00:00.000Z",
          },
          domain: "WWW.EXAMPLE.COM",
          id: "cd_def456",
          platformAddressId: "pa_abc123",
          routing: { status: "ready" },
          status: "running",
          targetPort: 8080,
        },
      ],
      privateAddress: "http://api:8080",
      privatePort: 8080,
      publicAddresses: [
        {
          host: "api.example.dev",
          id: "pa_abc123",
          port: 8080,
          status: "running",
          type: "platform",
          url: "https://api.example.dev/",
        },
      ],
    },
  };

  assert.deepEqual(apPendingTargetsForDirtyDomains(base, draft).network, {
    appListeningPorts: [{ port: 8080 }],
    customDomains: [
      {
        domain: "www.example.com",
        id: "cd_def456",
        platformAddressId: "pa_abc123",
      },
    ],
    privatePort: 8080,
    publicAddresses: [{ id: "pa_abc123", port: 8080 }],
  });
});
