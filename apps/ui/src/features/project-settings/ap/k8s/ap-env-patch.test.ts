import assert from "node:assert/strict";
import { test } from "node:test";

import { PLATFORM_ADDRESS_ID_RE } from "@/features/project-settings/ap/lib/platform-address";
import {
  apMergePatchFromJsonPatchOps,
  patchOpsForApEnvSettings,
  patchOpsForApNetworkSettings,
  patchOpsForApPrivatePortSettings,
  patchOpsForApPublicAddressesSettings,
  patchOpsForApReplicaStrategySettings,
  patchOpsForApResourceQuotaSettings,
  patchOpsForApSettingsDraft,
} from "./ap-json-patch";
import type { K8sJsonPatchOp } from "./http/json-patch";

const DUPLICATE_ENV_NAME_RE = /Environment variable names must be unique/;
const APP_LISTENING_PORT_RANGE_RE =
  /App Listening Port must be an integer from 1 through 65535/;
const PUBLIC_PORT_RANGE_RE =
  /Public Address target port must be an integer from 1 through 65535/;
const PLATFORM_ADDRESS_ID_INVALID_RE =
  /Platform Address ID must match \^pa_\[a-z0-9\]\{6,32\}\$/;
const PLATFORM_ADDRESS_ID_UNIQUE_RE = /Platform Address IDs must be unique/;
const CUSTOM_DOMAIN_ID_INVALID_RE =
  /Custom Domain Binding ID must match \^cd_\[a-z0-9\]\{6,32\}\$/;
const CUSTOM_DOMAIN_PLATFORM_ADDRESS_MISSING_RE =
  /Custom Domain Binding must reference an existing Platform Address/;
const CUSTOM_DOMAIN_PLATFORM_ADDRESS_UNIQUE_RE =
  /Platform Address can only be bound to one Custom Domain/;
const CUSTOM_DOMAIN_DUPLICATE_RE =
  /Custom Domain is already bound in this namespace/;
const UNRESOLVED_PGPASSWORD_RE = /Choose a Reference or create PGPASSWORD/;

function patchOpValue(op: K8sJsonPatchOp | undefined): unknown {
  if (op === undefined || op.op === "remove") {
    assert.fail("Expected patch operation with a value.");
  }
  return op.value;
}

function editorToken(name: string): string {
  return ["$", "{{", name, "}}"].join("");
}

function referenceExpression(db: string, variable: string): string {
  return ["$", "{{", db, ".", variable, "}}"].join("");
}

test("AP env settings patch direct rows as standard Kubernetes value entries", () => {
  const ops = patchOpsForApEnvSettings(
    {
      input: {
        env: [{ name: "DATABASE_URL", value: "postgres://old" }],
        image: "ghcr.io/acme/app:old",
      },
      resource: { replicas: 2 },
    },
    [
      { name: "DATABASE_URL", value: "postgres://db:5432/app" },
      { name: "FEATURE_FLAG", value: "true" },
    ]
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/env",
      value: [
        { name: "DATABASE_URL", value: "postgres://db:5432/app" },
        { name: "FEATURE_FLAG", value: "true" },
      ],
    },
    {
      op: "add",
      path: "/spec/input/envRawSource",
      value: "DATABASE_URL=postgres://db:5432/app\nFEATURE_FLAG=true",
    },
  ]);
});

test("AP env settings patch carries canonical raw source plus compiled runtime env", () => {
  const source = [
    "# database",
    "DATABASE_URL='postgres://db:5432/app' # private dsn",
    "",
    "FEATURE_FLAG=true",
  ].join("\n");

  const ops = patchOpsForApEnvSettings(
    {
      input: {
        env: [{ name: "DATABASE_URL", value: "postgres://old" }],
        envRawSource: "DATABASE_URL=postgres://old",
      },
    },
    [
      { name: "DATABASE_URL", value: "postgres://db:5432/app" },
      { name: "FEATURE_FLAG", value: "true" },
    ],
    { envRawSource: source }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/env",
      value: [
        { name: "DATABASE_URL", value: "postgres://db:5432/app" },
        { name: "FEATURE_FLAG", value: "true" },
      ],
    },
    {
      op: "replace",
      path: "/spec/input/envRawSource",
      value: source,
    },
  ]);
});

test("AP env settings patch compiles raw DB references into runtime env helpers", () => {
  const secretRefs = {
    host: { key: "endpoint", name: "postgres-conn-credential" },
    password: { key: "passwd", name: "postgres-conn-credential" },
    port: { key: "port", name: "postgres-conn-credential" },
    username: { key: "user", name: "postgres-conn-credential" },
  };
  const source = [
    "PGUSER=manual",
    `DATABASE_URL=${referenceExpression("Postgres", "database_url")}`,
  ].join("\n");

  const ops = patchOpsForApEnvSettings({ input: { env: [] } }, [], {
    dbDsnReferenceSources: [
      {
        name: "postgres",
        namespace: "default",
        primitiveSecretRefs: secretRefs,
      },
    ],
    envRawSource: source,
  });

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/env",
      value: [
        { name: "PGUSER", value: "manual" },
        {
          name: "DATABASE_URL",
          value:
            "postgresql://$(POSTGRES_USERNAME):$(POSTGRES_PASSWORD)@$(POSTGRES_HOST):$(POSTGRES_PORT)",
        },
        {
          name: "POSTGRES_USERNAME",
          valueFrom: { secretKeyRef: secretRefs.username },
        },
        {
          name: "POSTGRES_PASSWORD",
          valueFrom: { secretKeyRef: secretRefs.password },
        },
        {
          name: "POSTGRES_HOST",
          valueFrom: { secretKeyRef: secretRefs.host },
        },
        {
          name: "POSTGRES_PORT",
          valueFrom: { secretKeyRef: secretRefs.port },
        },
      ],
    },
    {
      op: "add",
      path: "/spec/input/envRawSource",
      value: [
        "PGUSER=manual",
        `DATABASE_URL=${referenceExpression("postgres", "DATABASE_URL")}`,
      ].join("\n"),
    },
  ]);
});

test("AP settings JSON patch ops convert to product merge patch", () => {
  const ops = [
    {
      op: "replace" as const,
      path: "/spec/input/image",
      value: "nginx:1.28",
    },
    {
      op: "replace" as const,
      path: "/spec/input/env",
      value: [{ name: "FEATURE_FLAG", value: "true" }],
    },
    {
      op: "add" as const,
      path: "/spec/resource/limits",
      value: { cpu: "500m", memory: "512Mi" },
    },
    {
      op: "add" as const,
      path: "/metadata/labels/region",
      value: "apps.example.com",
    },
    { op: "remove" as const, path: "/spec/input/host" },
  ];

  assert.deepEqual(apMergePatchFromJsonPatchOps(ops), {
    metadata: {
      labels: {
        region: "apps.example.com",
      },
    },
    spec: {
      input: {
        env: [{ name: "FEATURE_FLAG", value: "true" }],
        host: null,
        image: "nginx:1.28",
      },
      resource: {
        limits: { cpu: "500m", memory: "512Mi" },
      },
    },
  });
});

test("AP network settings patch privatePort without writing retired endpoint fields", () => {
  const ops = patchOpsForApNetworkSettings(
    {
      input: {
        endpoints: [{ host: "old.example.com", port: 80 }],
        host: "old.example.com",
        image: "ghcr.io/acme/app:old",
        port: 80,
      },
    },
    { privatePort: 8080 }
  );

  assert.deepEqual(ops, [
    {
      op: "add",
      path: "/spec/input/network",
      value: { appListeningPorts: [{ port: 8080 }] },
    },
    { op: "remove", path: "/spec/input/endpoints" },
    { op: "remove", path: "/spec/input/port" },
    { op: "remove", path: "/spec/input/host" },
  ]);
});

test("AP network settings patch generated Platform Address IDs as one coherent network object", () => {
  const ops = patchOpsForApNetworkSettings(
    {
      input: {
        endpoints: [{ host: "old.example.com", port: 80 }],
        host: "old.example.com",
        network: {
          appListeningPorts: [{ port: 80 }],
          publicAddresses: [{ host: "old.example.com", port: 80 }],
        },
        port: 80,
      },
    },
    {
      appListeningPorts: [{ port: 8080 }],
      publicAddresses: [
        {
          host: "api.example.com",
          port: 8080,
          status: "Accessible",
          type: "platform",
          url: "https://api.example.com/",
        },
        { host: "admin.example.com", port: 9000 },
      ],
    }
  );

  assert.equal(ops.length, 4);
  assert.deepEqual(ops.slice(1), [
    { op: "remove", path: "/spec/input/endpoints" },
    { op: "remove", path: "/spec/input/port" },
    { op: "remove", path: "/spec/input/host" },
  ]);
  assert.equal(ops[0]?.op, "replace");
  assert.equal(ops[0]?.path, "/spec/input/network");
  const network = ops[0]?.value as {
    appListeningPorts: { port: number }[];
    platformAddresses: { id: string; port: number }[];
  };
  assert.deepEqual(network.appListeningPorts, [{ port: 8080 }]);
  assert.equal(network.platformAddresses.length, 2);
  assert.match(network.platformAddresses[0]?.id ?? "", PLATFORM_ADDRESS_ID_RE);
  assert.equal(network.platformAddresses[0]?.port, 8080);
  assert.match(network.platformAddresses[1]?.id ?? "", PLATFORM_ADDRESS_ID_RE);
  assert.equal(network.platformAddresses[1]?.port, 9000);
});

test("AP network settings writes v1 Platform Addresses with stable IDs and no host or URL", () => {
  const ops = patchOpsForApNetworkSettings(
    {
      input: {
        network: {
          appListeningPorts: [{ port: 80 }],
          publicAddresses: [{ host: "old.example.com", port: 80 }],
        },
      },
    },
    {
      appListeningPorts: [{ port: 8080 }],
      publicAddresses: [
        {
          host: "api.example.com",
          id: "pa_abc123",
          port: 8080,
          status: "accessible",
          type: "platform",
          url: "https://api.example.com/",
        },
        { id: "pa_def456", port: 8080 },
      ],
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/network",
      value: {
        appListeningPorts: [{ port: 8080 }],
        platformAddresses: [
          { domainPrefix: "tsbmom", id: "pa_abc123", port: 8080 },
          { domainPrefix: "cafrvf", id: "pa_def456", port: 8080 },
        ],
      },
    },
  ]);
});

test("AP network settings writes v1 Custom Domains as AP desired state", () => {
  const ops = patchOpsForApNetworkSettings(
    {
      input: {
        network: {
          appListeningPorts: [{ port: 80 }],
          platformAddresses: [{ id: "pa_abc123", port: 80 }],
        },
      },
    },
    {
      customDomains: [
        {
          dns: {
            status: "verified",
            target: "api.example.com",
            verifiedAt: "2026-06-12T00:00:00.000Z",
          },
          domain: "www.example.com",
          id: "cd_def456",
          platformAddressId: "pa_abc123",
        },
      ],
      appListeningPorts: [{ port: 8080 }],
      publicAddresses: [
        {
          host: "api.example.com",
          id: "pa_abc123",
          port: 8080,
          status: "accessible",
          type: "platform",
          url: "https://api.example.com/",
        },
      ],
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/network",
      value: {
        customDomains: [
          {
            dns: {
              status: "verified",
              target: "api.example.com",
              verifiedAt: "2026-06-12T00:00:00.000Z",
            },
            domain: "www.example.com",
            id: "cd_def456",
            platformAddressId: "pa_abc123",
          },
        ],
        platformAddresses: [
          { domainPrefix: "tsbmom", id: "pa_abc123", port: 8080 },
        ],
        appListeningPorts: [{ port: 8080 }],
      },
    },
  ]);
});

test("AP network settings backfills routing domain label when adding Public Addresses", () => {
  const ops = patchOpsForApNetworkSettings(
    {
      input: {
        network: {
          appListeningPorts: [{ port: 80 }],
        },
      },
    },
    {
      appListeningPorts: [{ port: 80 }],
      publicAddresses: [{ id: "pa_abc123", port: 80 }],
    },
    {
      metadata: { labels: { "brain.io/project-id": "demo" } },
      routingDomain: "192.168.12.53.nip.io",
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/network",
      value: {
        appListeningPorts: [{ port: 80 }],
        platformAddresses: [
          { domainPrefix: "tsbmom", id: "pa_abc123", port: 80 },
        ],
      },
    },
    {
      op: "add",
      path: "/metadata/labels/region",
      value: "192.168.12.53.nip.io",
    },
  ]);
});

test("AP network settings preserves existing routing domain label", () => {
  const ops = patchOpsForApNetworkSettings(
    { input: { network: { privatePort: 80 } } },
    {
      appListeningPorts: [{ port: 80 }],
      publicAddresses: [{ id: "pa_abc123", port: 80 }],
    },
    {
      metadata: { labels: { region: "custom.example.com" } },
      routingDomain: "192.168.12.53.nip.io",
    }
  );

  assert.equal(ops.length, 1);
  assert.equal(ops[0]?.path, "/spec/input/network");
});

test("AP public address settings patch does not rewrite unchanged App Listening Ports", () => {
  const ops = patchOpsForApPublicAddressesSettings(
    {
      input: {
        network: {
          customDomains: [
            {
              domain: "old.example.com",
              id: "cd_old123",
              platformAddressId: "pa_old123",
            },
          ],
          platformAddresses: [{ id: "pa_old123", port: 80 }],
          appListeningPorts: [{ port: 80 }],
        },
      },
    },
    {
      customDomains: [
        {
          domain: "www.example.com",
          id: "cd_def456",
          platformAddressId: "pa_new456",
        },
      ],
      publicAddresses: [{ id: "pa_new456", port: 8080 }],
    },
    {
      metadata: { labels: { region: "custom.example.com" } },
      routingDomain: "192.168.12.53.nip.io",
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/network/platformAddresses",
      value: [{ domainPrefix: "fxeigg", id: "pa_new456", port: 8080 }],
    },
    {
      op: "replace",
      path: "/spec/input/network/customDomains",
      value: [
        {
          domain: "www.example.com",
          id: "cd_def456",
          platformAddressId: "pa_new456",
        },
      ],
    },
  ]);
});

test("AP public address settings patch persists auto-added App Listening Port", () => {
  const ops = patchOpsForApPublicAddressesSettings(
    {
      input: {
        network: {
          appListeningPorts: [{ port: 80 }],
        },
      },
    },
    {
      appListeningPorts: [{ port: 80 }, { port: 8080 }],
      publicAddresses: [{ id: "pa_new456", port: 8080 }],
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/network/appListeningPorts",
      value: [{ port: 80 }, { port: 8080 }],
    },
    {
      op: "add",
      path: "/spec/input/network/platformAddresses",
      value: [{ domainPrefix: "fxeigg", id: "pa_new456", port: 8080 }],
    },
  ]);
});

test("AP public address settings patch removes the final Public Address", () => {
  const ops = patchOpsForApPublicAddressesSettings(
    {
      input: {
        network: {
          appListeningPorts: [{ port: 80 }],
          platformAddresses: [{ id: "pa_old123", port: 80 }],
        },
      },
    },
    {
      appListeningPorts: [{ port: 80 }],
      publicAddresses: [],
    }
  );

  assert.deepEqual(ops, [
    {
      op: "remove",
      path: "/spec/input/network/platformAddresses",
    },
  ]);
});

test("AP private port settings patch does not rewrite Public Addresses", () => {
  const ops = patchOpsForApPrivatePortSettings(
    {
      input: {
        network: {
          customDomains: [
            {
              domain: "www.example.com",
              id: "cd_def456",
              platformAddressId: "pa_abc123",
            },
          ],
          platformAddresses: [{ id: "pa_abc123", port: 80 }],
          appListeningPorts: [{ port: 80 }],
        },
      },
    },
    { privatePort: 8080 }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/network/appListeningPorts",
      value: [{ port: 8080 }],
    },
  ]);
});

test("AP network settings validate App Listening Ports", () => {
  for (const privatePort of [1, 65_535]) {
    assert.deepEqual(
      patchOpValue(
        patchOpsForApNetworkSettings(
          { input: {} },
          { appListeningPorts: [{ port: privatePort }] }
        )[0]
      ),
      { appListeningPorts: [{ port: privatePort }] }
    );
  }

  for (const privatePort of [0, 65_536, 8080.5]) {
    assert.throws(
      () =>
        patchOpsForApNetworkSettings(
          { input: {} },
          { appListeningPorts: [{ port: privatePort }] }
        ),
      APP_LISTENING_PORT_RANGE_RE
    );
  }
});

test("AP network settings validate Platform Address IDs and Public Address ports", () => {
  assert.throws(
    () =>
      patchOpsForApNetworkSettings(
        { input: {} },
        { privatePort: 8080, publicAddresses: [{ id: "pa_BAD", port: 8080 }] }
      ),
    PLATFORM_ADDRESS_ID_INVALID_RE
  );
  assert.throws(
    () =>
      patchOpsForApNetworkSettings(
        { input: {} },
        {
          appListeningPorts: [{ port: 8080 }],
          publicAddresses: [
            { id: "pa_abc123", port: 8080 },
            { id: "pa_abc123", port: 9000 },
          ],
        }
      ),
    PLATFORM_ADDRESS_ID_UNIQUE_RE
  );
  assert.throws(
    () =>
      patchOpsForApNetworkSettings(
        { input: {} },
        {
          appListeningPorts: [{ port: 8080 }],
          publicAddresses: [{ id: "pa_abc123", port: 65_536 }],
        }
      ),
    PUBLIC_PORT_RANGE_RE
  );
});

test("AP network settings ignore observed Public Address rows when saving desired platform addresses", () => {
  const ops = patchOpsForApNetworkSettings(
    {
      input: {
        network: {
          appListeningPorts: [{ port: 8080 }],
          platformAddresses: [{ id: "pa_abc123", port: 8080 }],
        },
      },
    },
    {
      appListeningPorts: [{ port: 8080 }],
      publicAddresses: [
        {
          host: "affine.example.com",
          id: "observed-affineweb01",
          port: 3010,
          status: "accessible",
          type: "observed",
          url: "https://affine.example.com/",
        },
        { id: "pa_abc123", port: 8080 },
      ],
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/network",
      value: {
        appListeningPorts: [{ port: 8080 }],
        platformAddresses: [
          { domainPrefix: "tsbmom", id: "pa_abc123", port: 8080 },
        ],
      },
    },
  ]);
});

test("AP network settings validate Custom Domain Binding references", () => {
  assert.throws(
    () =>
      patchOpsForApNetworkSettings(
        { input: {} },
        {
          customDomains: [
            {
              domain: "www.example.com",
              id: "custom-domain",
              platformAddressId: "pa_abc123",
            },
          ],
          appListeningPorts: [{ port: 8080 }],
          publicAddresses: [{ id: "pa_abc123", port: 8080 }],
        }
      ),
    CUSTOM_DOMAIN_ID_INVALID_RE
  );

  assert.throws(
    () =>
      patchOpsForApNetworkSettings(
        { input: {} },
        {
          customDomains: [
            {
              domain: "www.example.com",
              id: "cd_def456",
              platformAddressId: "pa_missing",
            },
          ],
          appListeningPorts: [{ port: 8080 }],
          publicAddresses: [{ id: "pa_abc123", port: 8080 }],
        }
      ),
    CUSTOM_DOMAIN_PLATFORM_ADDRESS_MISSING_RE
  );

  assert.throws(
    () =>
      patchOpsForApNetworkSettings(
        { input: {} },
        {
          customDomains: [
            {
              domain: "www.example.com",
              id: "cd_def456",
              platformAddressId: "pa_abc123",
            },
            {
              domain: "api.example.com",
              id: "cd_ghi789",
              platformAddressId: "pa_abc123",
            },
          ],
          appListeningPorts: [{ port: 8080 }],
          publicAddresses: [{ id: "pa_abc123", port: 8080 }],
        }
      ),
    CUSTOM_DOMAIN_PLATFORM_ADDRESS_UNIQUE_RE
  );
});

test("AP network settings reject duplicate Custom Domains in the namespace routing scope", () => {
  const network = {
    customDomains: [
      {
        domain: "WWW.Example.COM.",
        id: "cd_def456",
        platformAddressId: "pa_abc123",
      },
    ],
    appListeningPorts: [{ port: 8080 }],
    publicAddresses: [{ id: "pa_abc123", port: 8080 }],
  };

  assert.throws(
    () =>
      patchOpsForApNetworkSettings({ input: {} }, network, {
        existingCustomDomains: [
          {
            apRef: "worker",
            domain: "www.example.com",
            namespace: "default",
          },
        ],
        metadata: { name: "api", namespace: "default" },
      }),
    CUSTOM_DOMAIN_DUPLICATE_RE
  );

  assert.doesNotThrow(() =>
    patchOpsForApNetworkSettings({ input: {} }, network, {
      existingCustomDomains: [
        {
          apRef: "api",
          domain: "www.example.com",
          namespace: "default",
        },
      ],
      metadata: { name: "api", namespace: "default" },
    })
  );

  assert.throws(
    () =>
      patchOpsForApNetworkSettings({ input: {} }, network, {
        existingCustomDomains: [
          {
            apRef: "worker",
            domain: "www.example.com",
            id: "cd_def456",
            namespace: "default",
          },
        ],
        metadata: { name: "api", namespace: "default" },
      }),
    CUSTOM_DOMAIN_DUPLICATE_RE
  );
});

test("AP network settings keep bound Custom Domains following Platform Address port changes", () => {
  const ops = patchOpsForApNetworkSettings(
    {
      input: {
        network: {
          customDomains: [
            {
              domain: "www.example.com",
              id: "cd_def456",
              platformAddressId: "pa_abc123",
            },
          ],
          platformAddresses: [{ id: "pa_abc123", port: 8080 }],
          appListeningPorts: [{ port: 8080 }],
        },
      },
    },
    {
      customDomains: [
        {
          domain: "www.example.com",
          id: "cd_def456",
          platformAddressId: "pa_abc123",
          status: "accessible",
        },
      ],
      appListeningPorts: [{ port: 8080 }],
      publicAddresses: [
        {
          host: "ucflzg.apps.example.com",
          id: "pa_abc123",
          port: 9000,
          status: "accessible",
          type: "platform",
          url: "https://ucflzg.apps.example.com/",
        },
      ],
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/network",
      value: {
        customDomains: [
          {
            domain: "www.example.com",
            id: "cd_def456",
            platformAddressId: "pa_abc123",
          },
        ],
        platformAddresses: [
          { domainPrefix: "tsbmom", id: "pa_abc123", port: 9000 },
        ],
        appListeningPorts: [{ port: 8080 }],
      },
    },
  ]);
});

test("AP resource quota settings write canonical fixed replica strategy", () => {
  const ops = patchOpsForApResourceQuotaSettings(
    {
      resource: {
        limits: { cpu: "1000m", memory: "1024Mi" },
        replicas: 2,
      },
    },
    { cpuCores: 2, memoryMib: 2048, replicas: 4 }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/resource",
      value: {
        limits: { cpu: "2", memory: "2048Mi" },
        replicaStrategy: {
          fixed: { replicas: 4 },
          type: "fixed",
        },
        replicas: 2,
      },
    },
  ]);
});

test("AP resource quota settings canonicalize legacy replicas on capacity-only saves", () => {
  const ops = patchOpsForApResourceQuotaSettings(
    {
      resource: {
        limits: { cpu: "1000m", memory: "1024Mi" },
        replicas: 3,
      },
    },
    { cpuCores: 2, replicas: 3 }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/resource",
      value: {
        limits: { cpu: "2", memory: "1024Mi" },
        replicaStrategy: {
          fixed: { replicas: 3 },
          type: "fixed",
        },
        replicas: 3,
      },
    },
  ]);
});

test("AP resource quota settings preserve inactive elastic settings on fixed saves", () => {
  const ops = patchOpsForApResourceQuotaSettings(
    {
      resource: {
        replicaStrategy: {
          elastic: {
            maxReplicas: 8,
            minReplicas: 2,
            target: {
              metric: "cpu",
              type: "utilization",
              utilizationPercent: 75,
            },
          },
          fixed: { replicas: 4 },
          type: "elastic",
        },
      },
    },
    { replicas: 5 }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/resource",
      value: {
        replicaStrategy: {
          elastic: {
            maxReplicas: 8,
            minReplicas: 2,
            target: {
              metric: "cpu",
              type: "utilization",
              utilizationPercent: 75,
            },
          },
          fixed: { replicas: 5 },
          type: "fixed",
        },
      },
    },
  ]);
});

test("AP replica strategy settings preserve existing inactive elastic branch on fixed saves", () => {
  const ops = patchOpsForApReplicaStrategySettings(
    {
      resource: {
        replicaStrategy: {
          elastic: {
            maxReplicas: 8,
            minReplicas: 2,
            target: {
              averageValue: "512Mi",
              metric: "memory",
              type: "averageValue",
            },
          },
          fixed: { replicas: 3 },
          type: "elastic",
        },
      },
    },
    {
      fixed: { replicas: 5 },
      type: "fixed",
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/resource",
      value: {
        replicaStrategy: {
          elastic: {
            maxReplicas: 8,
            minReplicas: 2,
            target: {
              averageValue: "512Mi",
              metric: "memory",
              type: "averageValue",
            },
          },
          fixed: { replicas: 5 },
          type: "fixed",
        },
      },
    },
  ]);
});

test("AP replica strategy settings write canonical CPU elastic branch", () => {
  const ops = patchOpsForApReplicaStrategySettings(
    {
      resource: {
        limits: { cpu: "1000m", memory: "1024Mi" },
        replicaStrategy: {
          fixed: { replicas: 4 },
          type: "fixed",
        },
        replicas: 3,
      },
    },
    {
      elastic: {
        maxReplicas: 8,
        minReplicas: 2,
        target: {
          metric: "cpu",
          type: "utilization",
          utilizationPercent: 75,
        },
      },
      fixed: { replicas: 4 },
      type: "elastic",
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/resource",
      value: {
        limits: { cpu: "1000m", memory: "1024Mi" },
        replicaStrategy: {
          elastic: {
            maxReplicas: 8,
            minReplicas: 2,
            target: {
              metric: "cpu",
              type: "utilization",
              utilizationPercent: 75,
            },
          },
          fixed: { replicas: 4 },
          type: "elastic",
        },
        replicas: 3,
      },
    },
  ]);
});

test("AP replica strategy settings write canonical Memory elastic branch", () => {
  const ops = patchOpsForApReplicaStrategySettings(
    {
      resource: {
        limits: { cpu: "1000m", memory: "1024Mi" },
        replicaStrategy: {
          fixed: { replicas: 4 },
          type: "fixed",
        },
        replicas: 3,
      },
    },
    {
      elastic: {
        maxReplicas: 8,
        minReplicas: 2,
        target: {
          averageValue: "512Mi",
          metric: "memory",
          type: "averageValue",
        },
      },
      fixed: { replicas: 4 },
      type: "elastic",
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/resource",
      value: {
        limits: { cpu: "1000m", memory: "1024Mi" },
        replicaStrategy: {
          elastic: {
            maxReplicas: 8,
            minReplicas: 2,
            target: {
              averageValue: "512Mi",
              metric: "memory",
              type: "averageValue",
            },
          },
          fixed: { replicas: 4 },
          type: "elastic",
        },
        replicas: 3,
      },
    },
  ]);
});

test("AP env settings reject duplicate row names before patching", () => {
  assert.throws(
    () =>
      patchOpsForApEnvSettings({ input: { env: [] } }, [
        { name: "DATABASE_URL", value: "postgres://primary" },
        { name: "DATABASE_URL", value: "postgres://replica" },
      ]),
    DUPLICATE_ENV_NAME_RE
  );
});

test("AP env settings patch DB DSN references as plain value entries", () => {
  const ops = patchOpsForApEnvSettings({ input: { env: [] } }, [
    {
      dbDsn: {
        dbName: "postgres",
        dbNamespace: "default",
        field: "private",
      },
      name: "DATABASE_URL",
      value: "postgres://private",
      valueSource: "dbDsn",
    },
  ]);

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/env",
      value: [{ name: "DATABASE_URL", value: "postgres://private" }],
    },
    {
      op: "add",
      path: "/spec/input/envRawSource",
      value: "DATABASE_URL=postgres://private",
    },
  ]);
});

test("AP env settings patch DB primitive references as Secret key refs", () => {
  const secretKeyRef = { key: "passwd", name: "postgres-conn-credential" };
  const ops = patchOpsForApEnvSettings({ input: { env: [] } }, [
    {
      dbDsn: {
        dbName: "postgres",
        dbNamespace: "default",
        field: "password",
      },
      name: "DATABASE_PASSWORD",
      value: "(valueFrom)",
      valueFrom: { secretKeyRef },
      valueSource: "dbDsn",
    },
  ]);

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/env",
      value: [
        {
          name: "DATABASE_PASSWORD",
          valueFrom: { secretKeyRef },
        },
      ],
    },
    {
      op: "add",
      path: "/spec/input/envRawSource",
      value: "",
    },
  ]);
});

test("AP env settings patch editor tokens as Kubernetes env expansion with DB helpers", () => {
  const secretKeyRef = { key: "passwd", name: "postgres-conn-credential" };
  const ops = patchOpsForApEnvSettings(
    { input: { env: [] } },
    [
      {
        name: "DATABASE_URL",
        referenceDbKey: "default/postgres",
        value: `postgres://${editorToken("PGPASSWORD")}@db/app`,
      },
    ],
    {
      dbDsnReferenceSources: [
        {
          name: "postgres",
          namespace: "default",
          primitiveSecretRefs: {
            password: secretKeyRef,
          },
        },
      ],
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/env",
      value: [
        { name: "DATABASE_URL", value: "postgres://$(PGPASSWORD)@db/app" },
        { name: "PGPASSWORD", valueFrom: { secretKeyRef } },
      ],
    },
    {
      op: "add",
      path: "/spec/input/envRawSource",
      value: "DATABASE_URL=postgres://$(PGPASSWORD)@db/app",
    },
  ]);
});

test("AP env settings reject unresolved editor tokens before patching", () => {
  assert.throws(
    () =>
      patchOpsForApEnvSettings({ input: { env: [] } }, [
        {
          name: "DATABASE_URL",
          value: `postgres://${editorToken("PGPASSWORD")}@db/app`,
        },
      ]),
    UNRESOLVED_PGPASSWORD_RE
  );
});

test("AP env settings reject duplicate names across direct and DB DSN reference rows", () => {
  assert.throws(
    () =>
      patchOpsForApEnvSettings({ input: { env: [] } }, [
        { name: "DATABASE_URL", value: "postgres://manual" },
        {
          dbDsn: {
            dbName: "postgres",
            dbNamespace: "default",
            field: "private",
          },
          name: "DATABASE_URL",
          value: "postgres://private",
          valueSource: "dbDsn",
        },
      ]),
    DUPLICATE_ENV_NAME_RE
  );
});

test("AP env settings preserve non-direct rows unless they are deleted", () => {
  const secretKeyRef = { key: "password", name: "external-db" };
  const spec = {
    input: {
      env: [
        { name: "DATABASE_URL", value: "postgres://db:5432/app" },
        { name: "DATABASE_PASSWORD", valueFrom: { secretKeyRef } },
      ],
    },
  };

  assert.deepEqual(
    patchOpValue(
      patchOpsForApEnvSettings(spec, [
        { name: "DATABASE_URL", value: "postgres://db:5432/app" },
        {
          name: "DATABASE_PASSWORD",
          value: "(valueFrom)",
          valueFrom: { secretKeyRef },
          valueSource: "valueFrom",
        },
      ])[0]
    ),
    [
      { name: "DATABASE_URL", value: "postgres://db:5432/app" },
      { name: "DATABASE_PASSWORD", valueFrom: { secretKeyRef } },
    ]
  );

  assert.deepEqual(
    patchOpValue(
      patchOpsForApEnvSettings(spec, [
        { name: "DATABASE_URL", value: "postgres://db:5432/app" },
      ])[0]
    ),
    [{ name: "DATABASE_URL", value: "postgres://db:5432/app" }]
  );
});

test("AP settings draft builds one patch for combined dirty settings", () => {
  const previous = {
    cpuCores: 1,
    env: [{ name: "DATABASE_URL", value: "postgres://old" }],
    envRawSource: "DATABASE_URL=postgres://old",
    image: "ghcr.io/acme/api:old",
    memoryMib: 1024,
    network: {
      appListeningPorts: [{ port: 80 }],
      publicAddresses: [{ id: "pa_old123", port: 80 }],
    },
    replicaStrategy: {
      fixed: { replicas: 2 },
      type: "fixed",
    },
  } as const;

  const ops = patchOpsForApSettingsDraft(
    {
      input: {
        env: [{ name: "DATABASE_URL", value: "postgres://old" }],
        envRawSource: "DATABASE_URL=postgres://old",
        image: "ghcr.io/acme/api:old",
        network: {
          appListeningPorts: [{ port: 80 }],
          platformAddresses: [{ id: "pa_old123", port: 80 }],
        },
      },
      resource: {
        limits: { cpu: "1", memory: "1024Mi" },
        replicaStrategy: {
          fixed: { replicas: 2 },
          type: "fixed",
        },
        replicas: 2,
      },
    },
    {
      cpuCores: 2,
      env: [
        { name: "DATABASE_URL", value: "postgres://new" },
        { name: "FEATURE_FLAG", value: "true" },
      ],
      envRawSource: "DATABASE_URL=postgres://new\nFEATURE_FLAG=true",
      image: "ghcr.io/acme/api:new",
      memoryMib: 2048,
      network: {
        appListeningPorts: [{ port: 8080 }],
        publicAddresses: [
          { id: "pa_old123", port: 8080 },
          { id: "pa_new456", port: 9000 },
        ],
      },
      replicaStrategy: {
        elastic: {
          maxReplicas: 8,
          minReplicas: 2,
          target: {
            metric: "cpu",
            type: "utilization",
            utilizationPercent: 75,
          },
        },
        fixed: { replicas: 2 },
        type: "elastic",
      },
    },
    previous,
    {
      metadata: { labels: { "brain.io/project-id": "demo" } },
      routingDomain: "192.168.12.53.nip.io",
    }
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/image",
      value: "ghcr.io/acme/api:new",
    },
    {
      op: "replace",
      path: "/spec/input/env",
      value: [
        { name: "DATABASE_URL", value: "postgres://new" },
        { name: "FEATURE_FLAG", value: "true" },
      ],
    },
    {
      op: "replace",
      path: "/spec/input/envRawSource",
      value: "DATABASE_URL=postgres://new\nFEATURE_FLAG=true",
    },
    {
      op: "replace",
      path: "/spec/input/network",
      value: {
        appListeningPorts: [{ port: 8080 }],
        platformAddresses: [
          { domainPrefix: "fffpnc", id: "pa_old123", port: 8080 },
          { domainPrefix: "fxeigg", id: "pa_new456", port: 9000 },
        ],
      },
    },
    {
      op: "add",
      path: "/metadata/labels/region",
      value: "192.168.12.53.nip.io",
    },
    {
      op: "replace",
      path: "/spec/resource",
      value: {
        limits: { cpu: "2", memory: "2048Mi" },
        replicaStrategy: {
          elastic: {
            maxReplicas: 8,
            minReplicas: 2,
            target: {
              metric: "cpu",
              type: "utilization",
              utilizationPercent: 75,
            },
          },
          fixed: { replicas: 2 },
          type: "elastic",
        },
        replicas: 2,
      },
    },
  ]);
});

test("AP settings draft persists Custom Domain Bindings only on panel Save", () => {
  const previous = {
    cpuCores: 1,
    env: [],
    image: "ghcr.io/acme/api:old",
    memoryMib: 1024,
    network: {
      appListeningPorts: [{ port: 80 }],
      publicAddresses: [{ id: "pa_abc123", port: 80 }],
    },
    replicaStrategy: {
      fixed: { replicas: 2 },
      type: "fixed",
    },
  } as const;

  const ops = patchOpsForApSettingsDraft(
    {
      input: {
        env: [],
        image: "ghcr.io/acme/api:old",
        network: {
          appListeningPorts: [{ port: 80 }],
          platformAddresses: [{ id: "pa_abc123", port: 80 }],
        },
      },
      resource: {
        limits: { cpu: "1", memory: "1024Mi" },
        replicaStrategy: {
          fixed: { replicas: 2 },
          type: "fixed",
        },
      },
    },
    {
      ...previous,
      network: {
        customDomains: [
          {
            dns: {
              status: "verified",
              target: "api.example.com",
              verifiedAt: "2026-06-12T00:00:00.000Z",
            },
            domain: "www.example.com",
            id: "cd_def456",
            platformAddressId: "pa_abc123",
          },
        ],
        appListeningPorts: [{ port: 80 }],
        publicAddresses: [{ id: "pa_abc123", port: 80 }],
      },
    },
    previous
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/network",
      value: {
        customDomains: [
          {
            dns: {
              status: "verified",
              target: "api.example.com",
              verifiedAt: "2026-06-12T00:00:00.000Z",
            },
            domain: "www.example.com",
            id: "cd_def456",
            platformAddressId: "pa_abc123",
          },
        ],
        platformAddresses: [
          { domainPrefix: "tsbmom", id: "pa_abc123", port: 80 },
        ],
        appListeningPorts: [{ port: 80 }],
      },
    },
  ]);
});

test("AP settings draft merge patch clears the final Public Address", () => {
  const previous = {
    cpuCores: 1,
    env: [],
    image: "ghcr.io/acme/api:old",
    memoryMib: 1024,
    network: {
      appListeningPorts: [{ port: 80 }],
      publicAddresses: [{ id: "pa_old123", port: 80 }],
    },
    replicaStrategy: {
      fixed: { replicas: 2 },
      type: "fixed",
    },
  } as const;

  const ops = patchOpsForApSettingsDraft(
    {
      input: {
        env: [],
        image: "ghcr.io/acme/api:old",
        network: {
          appListeningPorts: [{ port: 80 }],
          platformAddresses: [{ id: "pa_old123", port: 80 }],
        },
      },
      resource: {
        limits: { cpu: "1", memory: "1024Mi" },
        replicaStrategy: {
          fixed: { replicas: 2 },
          type: "fixed",
        },
      },
    },
    {
      ...previous,
      network: {
        appListeningPorts: [{ port: 80 }],
        publicAddresses: [],
      },
    },
    previous
  );

  assert.deepEqual(apMergePatchFromJsonPatchOps(ops), {
    spec: {
      input: {
        network: {
          appListeningPorts: [{ port: 80 }],
          customDomains: null,
          endpoints: null,
          host: null,
          platformAddresses: null,
          port: null,
          privatePort: null,
          publicAddresses: null,
        },
      },
    },
  });
});

test("AP settings draft patches command args config files and storage", () => {
  const previous = {
    args: ["--old"],
    command: ["/app/old"],
    configMaps: [{ path: "/etc/app/config.yaml", value: "debug: false" }],
    cpuCores: 1,
    env: [],
    image: "ghcr.io/acme/api:old",
    memoryMib: 1024,
    replicaStrategy: {
      fixed: { replicas: 1 },
      type: "fixed",
    },
    storage: [{ path: "/data", size: "10Gi" }],
  } as const;

  const ops = patchOpsForApSettingsDraft(
    {
      input: {
        args: ["--old"],
        command: ["/app/old"],
        configMaps: [{ path: "/etc/app/config.yaml", value: "debug: false" }],
        env: [],
        image: "ghcr.io/acme/api:old",
        storage: [{ path: "/data", size: "10Gi" }],
      },
      resource: {
        limits: { cpu: "1", memory: "1024Mi" },
        replicaStrategy: {
          fixed: { replicas: 1 },
          type: "fixed",
        },
      },
    },
    {
      ...previous,
      args: ["--config", "/etc/app/config.yaml"],
      command: ["/app/server"],
      configMaps: [{ path: "/etc/app/config.yaml", value: "debug: true" }],
      storage: [{ path: "/data", size: "20Gi" }],
    },
    previous
  );

  assert.deepEqual(apMergePatchFromJsonPatchOps(ops), {
    spec: {
      input: {
        args: ["--config", "/etc/app/config.yaml"],
        command: ["/app/server"],
        configMaps: [{ path: "/etc/app/config.yaml", value: "debug: true" }],
        storage: [{ path: "/data", size: "20Gi" }],
      },
    },
  });
});

test("AP settings draft omits unchanged settings from the patch", () => {
  const previous = {
    cpuCores: 1,
    env: [{ name: "DATABASE_URL", value: "postgres://old" }],
    image: "ghcr.io/acme/api:old",
    memoryMib: 1024,
    network: {
      appListeningPorts: [{ port: 80 }],
      publicAddresses: [{ id: "pa_old123", port: 80 }],
    },
    replicaStrategy: {
      fixed: { replicas: 2 },
      type: "fixed",
    },
  } as const;

  const ops = patchOpsForApSettingsDraft(
    {
      input: {
        env: [{ name: "DATABASE_URL", value: "postgres://old" }],
        image: "ghcr.io/acme/api:old",
        network: {
          appListeningPorts: [{ port: 80 }],
          platformAddresses: [{ id: "pa_old123", port: 80 }],
        },
      },
      resource: {
        limits: { cpu: "1", memory: "1024Mi" },
        replicaStrategy: {
          fixed: { replicas: 2 },
          type: "fixed",
        },
      },
    },
    {
      ...previous,
      env: [{ name: "DATABASE_URL", value: "postgres://new" }],
    },
    previous
  );

  assert.deepEqual(ops, [
    {
      op: "replace",
      path: "/spec/input/env",
      value: [{ name: "DATABASE_URL", value: "postgres://new" }],
    },
    {
      op: "add",
      path: "/spec/input/envRawSource",
      value: "DATABASE_URL=postgres://new",
    },
  ]);
});
