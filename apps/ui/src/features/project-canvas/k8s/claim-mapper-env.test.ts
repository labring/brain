import assert from "node:assert/strict";
import { test } from "node:test";

import { ContainerSettingsPane } from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { claimToContainerSettings } from "./claim-mapper";
import { dbDsnReferenceSourcesFromDbsData } from "./db-dsn-reference-sources";

const noop = () => {
  /* test noop */
};

const REPLICA_STRATEGY_RE = /Replica Strategy/;
const FIXED_REPLICAS_RE = /Fixed Replicas/;
const ELASTIC_SCALING_RE = /Elastic Scaling/;
const REPLICA_COUNT_RE = /Number of Replicas/;
const LEGACY_REPLICA_VALUE_RE = />3 Replicas</;
const BUTTON_RE = /<button/;

test("AP claim settings reconstruct direct and non-direct environment rows", () => {
  const secretKeyRef = {
    key: "password",
    name: "external-db",
  };

  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          env: [
            { name: "DATABASE_URL", value: "postgres://db:5432/app" },
            { name: "DATABASE_PASSWORD", valueFrom: { secretKeyRef } },
          ],
          image: "ghcr.io/acme/api:latest",
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.env, [
    { name: "DATABASE_URL", value: "postgres://db:5432/app" },
    {
      name: "DATABASE_PASSWORD",
      value: "(valueFrom)",
      valueFrom: { secretKeyRef },
      valueSource: "valueFrom",
    },
  ]);
});

test("AP claim settings maps private-only network from desired and observed AP state", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
          network: {
            privatePort: 8080,
          },
        },
      },
      status: {
        network: {
          privateAddress: "http://api-service-port-8080.default.svc:8080",
          privatePort: 8080,
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.network, {
    privateAddress: "http://api-service-port-8080.default.svc:8080",
    privatePort: 8080,
    publicAddresses: [],
  });
  assert.deepEqual(settings.ports, []);
});

test("AP claim settings maps public addresses from observed AP network state", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
          network: {
            privatePort: 8080,
            platformAddresses: [
              { id: "pa_abc123", port: 8080 },
              { id: "pa_admin9", port: 9000 },
            ],
          },
        },
      },
      status: {
        network: {
          privateAddress: "http://api-service-port-8080.default.svc:8080",
          privatePort: 8080,
          publicAddresses: [
            {
              host: "api.example.com",
              id: "pa_abc123",
              port: 8080,
              status: "accessible",
              type: "platform",
              url: "https://api.example.com/",
            },
            {
              host: "admin.example.com",
              id: "pa_admin9",
              port: 9000,
              status: "progressing",
              type: "platform",
              url: "http://admin.example.com/",
            },
          ],
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.network?.publicAddresses, [
    {
      host: "api.example.com",
      id: "pa_abc123",
      port: 8080,
      status: "accessible",
      type: "platform",
      url: "https://api.example.com/",
    },
    {
      host: "admin.example.com",
      id: "pa_admin9",
      port: 9000,
      status: "progressing",
      type: "platform",
      url: "http://admin.example.com/",
    },
  ]);
});

test("AP claim settings falls back to desired Platform Addresses while observed URLs are pending", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: {
        labels: { region: "apps.example.com" },
        name: "api",
        namespace: "default",
      },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
          network: {
            privatePort: 8080,
            platformAddresses: [{ id: "pa_abc123", port: 8080 }],
          },
        },
      },
      status: {
        network: {
          privateAddress: "http://api-service-port-8080.default.svc:8080",
          privatePort: 8080,
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.network?.publicAddresses, [
    {
      host: "api-7c6ad52581.apps.example.com",
      id: "pa_abc123",
      port: 8080,
      status: "progressing",
      type: "platform",
      url: "https://api-7c6ad52581.apps.example.com/",
    },
  ]);
});

test("AP claim settings maps desired Custom Domain Bindings into the network draft", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: {
        labels: { region: "apps.example.com" },
        name: "api",
        namespace: "default",
      },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
          network: {
            customDomains: [
              {
                domain: "www.example.com",
                id: "cd_def456",
                platformAddressId: "pa_abc123",
              },
            ],
            privatePort: 8080,
            platformAddresses: [{ id: "pa_abc123", port: 8080 }],
          },
        },
      },
      status: {
        network: {
          privatePort: 8080,
          publicAddresses: [
            {
              cnameTarget: "api-7c6ad52581.apps.example.com",
              host: "www.example.com",
              id: "cd_def456",
              platformAddressId: "pa_abc123",
              port: 8080,
              status: "pending",
              type: "custom",
              url: "https://www.example.com/",
            },
          ],
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.network?.customDomains, [
    {
      cnameTarget: "api-7c6ad52581.apps.example.com",
      domain: "www.example.com",
      id: "cd_def456",
      platformAddressId: "pa_abc123",
      status: "pending",
      targetPort: 8080,
    },
  ]);
  assert.deepEqual(settings.network?.publicAddresses, [
    {
      host: "api-7c6ad52581.apps.example.com",
      id: "pa_abc123",
      port: 8080,
      status: "progressing",
      type: "platform",
      url: "https://api-7c6ad52581.apps.example.com/",
    },
  ]);
});

test("AP claim settings prefers EntryPoint Custom Domain Binding health over AP projection", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: {
        labels: { region: "apps.example.com" },
        name: "api",
        namespace: "default",
      },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
          network: {
            customDomains: [
              {
                domain: "www.example.com",
                id: "cd_def456",
                platformAddressId: "pa_abc123",
              },
            ],
            privatePort: 8080,
            platformAddresses: [{ id: "pa_abc123", port: 8080 }],
          },
        },
      },
      status: {
        network: {
          privatePort: 8080,
          publicAddresses: [
            {
              cnameTarget: "api-7c6ad52581.apps.example.com",
              host: "www.example.com",
              id: "cd_def456",
              platformAddressId: "pa_abc123",
              port: 8080,
              status: "pending",
              type: "custom",
              url: "https://www.example.com/",
            },
          ],
        },
      },
    },
    "AP",
    {
      entryPointsData: {
        items: [
          {
            kind: "EntryPoint",
            metadata: { name: "api", namespace: "default" },
            spec: { apRef: "api" },
            status: {
              customDomains: [
                {
                  certificate: {
                    message: "Certificate request failed.",
                    reason: "IssuerNotReady",
                    status: "failed",
                  },
                  cnameTarget: "api-7c6ad52581.apps.example.com",
                  dns: {
                    message:
                      "CNAME for www.example.com was verified before save.",
                    status: "verified",
                  },
                  domain: "www.example.com",
                  id: "cd_def456",
                  platformAddressId: "pa_abc123",
                  routing: {
                    message: "Custom Domain Ingress has not been observed yet.",
                    reason: "IngressPending",
                    status: "pending",
                  },
                  status: "blocked",
                  targetPort: 8080,
                },
              ],
            },
          },
        ],
      },
    }
  );

  assert.deepEqual(settings.network?.customDomains, [
    {
      certificate: {
        message: "Certificate request failed.",
        reason: "IssuerNotReady",
        status: "failed",
      },
      cnameTarget: "api-7c6ad52581.apps.example.com",
      dns: {
        message: "CNAME for www.example.com was verified before save.",
        status: "verified",
      },
      domain: "www.example.com",
      id: "cd_def456",
      platformAddressId: "pa_abc123",
      routing: {
        message: "Custom Domain Ingress has not been observed yet.",
        reason: "IngressPending",
        status: "pending",
      },
      status: "blocked",
      targetPort: 8080,
    },
  ]);
});

test("AP claim settings Platform Address host ignores AP UID and target port", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: {
        labels: { region: "apps.example.com" },
        name: "api",
        namespace: "default",
        uid: "ap-uid-1",
      },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
          network: {
            privatePort: 8080,
            platformAddresses: [{ id: "pa_abc123", port: 9000 }],
          },
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.network?.publicAddresses, [
    {
      host: "api-7c6ad52581.apps.example.com",
      id: "pa_abc123",
      port: 9000,
      status: "progressing",
      type: "platform",
      url: "https://api-7c6ad52581.apps.example.com/",
    },
  ]);
});

test("AP claim settings leaves desired Platform Address hosts pending when draft inputs are missing", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
          network: {
            privatePort: 8080,
            platformAddresses: [{ id: "pa_abc123", port: 8080 }],
          },
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.network?.publicAddresses, [
    { id: "pa_abc123", port: 8080, status: "progressing", type: "platform" },
  ]);
});

test("AP claim settings ignores retired endpoint fields", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          endpoints: [{ host: "api.example.com", port: 8080 }],
          image: "ghcr.io/acme/api:latest",
        },
      },
      status: {
        endpoints: [
          {
            number: 8080,
            privateAddress: "http://api.default.svc:8080",
            publicAddress: "https://api.example.com/",
          },
        ],
      },
    },
    "AP"
  );

  assert.equal(settings.network, undefined);
  assert.deepEqual(settings.ports, []);
});

test("AP claim settings ignores invalid private-only network ports", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
          network: {
            privatePort: 8080.5,
          },
        },
      },
    },
    "AP"
  );

  assert.equal(settings.network, undefined);
});

test("AP claim settings maps canonical fixed replica strategy", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
        },
        resource: {
          replicaStrategy: {
            fixed: { replicas: 4 },
            type: "fixed",
          },
          replicas: 2,
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.replicaStrategy, {
    fixed: { replicas: 4 },
    type: "fixed",
  });
  assert.equal(settings.replicas, 4);
});

test("AP claim settings clamps displayed fixed replica strategy to AP bounds", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
        },
        resource: {
          replicaStrategy: {
            fixed: { replicas: 42 },
            type: "fixed",
          },
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.replicaStrategy, {
    fixed: { replicas: 20 },
    type: "fixed",
  });
  assert.equal(settings.replicas, 20);
});

test("AP claim settings maps legacy replicas as fixed replica strategy", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
        },
        resource: {
          replicas: 3,
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.replicaStrategy, {
    fixed: { replicas: 3 },
    type: "fixed",
  });
  assert.equal(settings.replicas, 3);
});

test("read-only AP settings renders legacy replicas as fixed replica strategy", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
        },
        resource: {
          replicas: 3,
        },
      },
    },
    "AP"
  );

  const html = renderToStaticMarkup(
    createElement(ContainerSettingsPane, {
      cpuQuota: { onValueChange: noop, value: settings.cpuCores },
      env: settings.env,
      image: settings.image,
      memoryQuota: { onValueChange: noop, value: settings.memoryMib },
      onEnvChange: noop,
      onImageChange: noop,
      onPortsChange: noop,
      ports: settings.ports,
      readOnly: true,
      replicaStrategy: settings.replicaStrategy,
      replicasQuota: { onValueChange: noop, value: settings.replicas },
    })
  );

  assert.match(html, REPLICA_STRATEGY_RE);
  assert.match(html, FIXED_REPLICAS_RE);
  assert.match(html, REPLICA_COUNT_RE);
  assert.match(html, LEGACY_REPLICA_VALUE_RE);
  assert.doesNotMatch(html, ELASTIC_SCALING_RE);
  assert.doesNotMatch(html, BUTTON_RE);
});

test("AP claim settings maps canonical CPU elastic replica strategy", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
        },
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
          replicas: 3,
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.replicaStrategy, {
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
  });
  assert.equal(settings.replicas, 4);
});

test("AP claim settings maps canonical Memory elastic replica strategy", () => {
  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          image: "ghcr.io/acme/api:latest",
        },
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
            fixed: { replicas: 4 },
            type: "elastic",
          },
          replicas: 3,
        },
      },
    },
    "AP"
  );

  assert.deepEqual(settings.replicaStrategy, {
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
  });
  assert.equal(settings.replicas, 4);
});

test("AP claim settings reconstruct DB DSN references only from exact current DB connection strings", () => {
  const dbDsnReferenceSources = dbDsnReferenceSourcesFromDbsData(
    {
      items: [
        {
          metadata: { name: "postgres", namespace: "default" },
          status: {
            connectionStringPrivate: "postgres://private",
            connectionStringPublic: "postgres://public",
          },
        },
        {
          metadata: { name: "empty", namespace: "default" },
          status: {},
        },
      ],
    },
    "default"
  );

  assert.deepEqual(dbDsnReferenceSources, [
    {
      name: "postgres",
      namespace: "default",
      privateDsn: "postgres://private",
      publicDsn: "postgres://public",
    },
    {
      name: "empty",
      namespace: "default",
    },
  ]);

  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          env: [
            { name: "DATABASE_URL", value: "postgres://private" },
            { name: "DATABASE_PUBLIC_URL", value: "postgres://public" },
            { name: "ALMOST_DATABASE_URL", value: "postgres://private " },
          ],
          image: "ghcr.io/acme/api:latest",
        },
      },
    },
    "AP",
    { dbDsnReferenceSources }
  );

  assert.deepEqual(settings.env, [
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
    {
      dbDsn: {
        dbName: "postgres",
        dbNamespace: "default",
        field: "public",
      },
      name: "DATABASE_PUBLIC_URL",
      value: "postgres://public",
      valueSource: "dbDsn",
    },
    { name: "ALMOST_DATABASE_URL", value: "postgres://private " },
  ]);
});

test("AP claim settings reconstruct DB primitive references from exact Secret evidence", () => {
  const secretKeyRef = { key: "user", name: "postgres-conn-credential" };
  const dbDsnReferenceSources = dbDsnReferenceSourcesFromDbsData(
    {
      items: [
        {
          metadata: { name: "postgres", namespace: "default" },
          status: {
            variables: [
              {
                name: "PG_USER",
                valueFrom: { secretKeyRef },
              },
            ],
          },
        },
      ],
    },
    "default"
  );

  assert.deepEqual(dbDsnReferenceSources, [
    {
      name: "postgres",
      namespace: "default",
      primitiveSecretRefs: {
        username: secretKeyRef,
      },
    },
  ]);

  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          env: [
            {
              name: "DATABASE_USER",
              valueFrom: { secretKeyRef },
            },
          ],
          image: "ghcr.io/acme/api:latest",
        },
      },
    },
    "AP",
    { dbDsnReferenceSources }
  );

  assert.deepEqual(settings.env, [
    {
      dbDsn: {
        dbName: "postgres",
        dbNamespace: "default",
        field: "username",
      },
      name: "DATABASE_USER",
      value: "(valueFrom)",
      valueFrom: { secretKeyRef },
      valueSource: "dbDsn",
    },
  ]);
});

test("AP claim settings leave non-matching Secret rows as external rows", () => {
  const dbDsnReferenceSources = dbDsnReferenceSourcesFromDbsData(
    {
      items: [
        {
          metadata: { name: "postgres", namespace: "default" },
          status: {
            variables: [
              {
                name: "PG_USER",
                valueFrom: {
                  secretKeyRef: {
                    key: "user",
                    name: "postgres-conn-credential",
                  },
                },
              },
            ],
          },
        },
      ],
    },
    "default"
  );
  const wrongName = {
    key: "user",
    name: "external-db",
  };
  const wrongKey = {
    key: "database",
    name: "postgres-conn-credential",
  };

  const settings = claimToContainerSettings(
    {
      kind: "AP",
      metadata: { name: "api", namespace: "default" },
      spec: {
        input: {
          env: [
            {
              name: "EXTERNAL_USER",
              valueFrom: { secretKeyRef: wrongName },
            },
            {
              name: "DATABASE_NAME",
              valueFrom: { secretKeyRef: wrongKey },
            },
          ],
        },
      },
    },
    "AP",
    { dbDsnReferenceSources }
  );

  assert.deepEqual(settings.env, [
    {
      name: "EXTERNAL_USER",
      value: "(valueFrom)",
      valueFrom: { secretKeyRef: wrongName },
      valueSource: "valueFrom",
    },
    {
      name: "DATABASE_NAME",
      value: "(valueFrom)",
      valueFrom: { secretKeyRef: wrongKey },
      valueSource: "valueFrom",
    },
  ]);
});
