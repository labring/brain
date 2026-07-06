import assert from "node:assert/strict";
import { test } from "node:test";
import { projectRuntimeFactsFromResources } from "./resource-facts";
import { projectRuntimeNodeModelsFromFacts } from "./resource-models";
import { createProjectRuntimeStore } from "./resource-store";

const AP_ENV_REFERENCE_PREFIX = "$";
const postgresDatabaseUrlReference = `${AP_ENV_REFERENCE_PREFIX}{{postgres.DATABASE_URL}}`;
const postgresHostReference = `${AP_ENV_REFERENCE_PREFIX}{{postgres.PG_HOST}}`;
const POSTGRESQL_ORIGINAL_ICON_RE = /postgresql-original\.svg/;

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    assert.fail("expected value to be present");
  }
  return value;
}

test("Project Runtime parses AP resources into app-owned read-side facts", () => {
  const rawAp = {
    metadata: {
      name: "api",
      namespace: "default",
      uid: "ap-uid",
    },
    spec: {
      input: {
        image: "nginx:1.27",
      },
      resource: {
        replicas: 2,
      },
    },
    status: {
      phase: "Running",
      readyReplicas: 2,
    },
  };

  const facts = projectRuntimeFactsFromResources({
    apsData: { items: [rawAp] },
    namespace: "default",
  });

  assert.deepEqual(facts.apFacts, [
    {
      displayName: "api",
      key: "AP:default:api",
      observedUid: "ap-uid",
      ref: { kind: "AP", name: "api", namespace: "default" },
      replicaSummary: { desired: 2, ready: 2 },
      status: { label: "Running", tone: "running" },
      workload: { image: "nginx:1.27", kind: "AP" },
    },
  ]);
  assert.equal("states" in required(facts.apFacts[0]), false);
  assert.equal("resource" in required(facts.apFacts[0]), false);
  assert.equal("raw" in required(facts.apFacts[0]), false);
});

test("Project Runtime parses DB resources into app-owned read-side facts", () => {
  const rawDb = {
    metadata: {
      labels: { region: "192.168.12.53.nip.io" },
      name: "postgres",
      namespace: "default",
      uid: "db-uid",
    },
    spec: {
      cpuLimit: "1000m",
      engine: "postgresql",
      exposeNodePort: true,
      memoryLimit: "2Gi",
      replicas: 3,
      storageSize: "20Gi",
    },
    status: {
      clusterVersionRef: "postgresql-15.4.0",
      connectionStringPrivate: "postgres://private",
      connectionStringPublic: "postgres://public",
      phase: "Running",
    },
  };

  const facts = projectRuntimeFactsFromResources({
    dbsData: { items: [rawDb] },
    namespace: "default",
  });

  assert.deepEqual(facts.dbFacts, [
    {
      capacitySummary: {
        cpu: "1000m",
        memory: "2Gi",
        storage: "20Gi",
      },
      connectionSummary: {
        private: { value: "postgres://private" },
        public: { enabled: true, value: "postgres://public" },
      },
      displayName: "postgres",
      engine: { displayName: "PostgreSQL", key: "postgresql" },
      key: "DB:default:postgres",
      metadataLabels: { region: "192.168.12.53.nip.io" },
      observedUid: "db-uid",
      ref: { kind: "DB", name: "postgres", namespace: "default" },
      status: { label: "Running", tone: "running" },
      version: "15.4",
    },
  ]);
  assert.equal("desired" in required(facts.dbFacts[0]), false);
  assert.equal("metadata" in required(facts.dbFacts[0]), false);
  assert.equal("states" in required(facts.dbFacts[0]), false);
  assert.equal("connections" in required(facts.dbFacts[0]), false);
});

test("Project Runtime parses AP Public Access as AP-bound read-side facts", () => {
  const rawAp = {
    metadata: {
      name: "api",
      namespace: "default",
      uid: "ap-uid",
    },
    spec: {
      input: {
        network: {
          platformAddresses: [{ id: "pa_abc123", port: 8080 }],
          privatePort: 8080,
        },
      },
    },
    status: {
      network: {
        privateAddress: "http://api-service.default.svc:8080",
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
        ],
      },
      phase: "Running",
    },
  };

  const facts = projectRuntimeFactsFromResources({
    apsData: { items: [rawAp] },
    namespace: "default",
  });

  assert.deepEqual(facts.publicAccessFacts, [
    {
      accessDomain: { label: "Access domain", value: "api.example.com" },
      apRef: { kind: "AP", name: "api", namespace: "default" },
      displayName: "api",
      key: "PublicAccess:default:api",
      observedUid: "ap-uid",
      ref: { kind: "PublicAccess", name: "api", namespace: "default" },
      targets: [
        {
          id: "pa_abc123",
          label: "Platform Address",
          port: 8080,
          status: { label: "Accessible", tone: "accessible" },
          type: "platform",
          value: "https://api.example.com/",
        },
      ],
    },
  ]);
  assert.equal("settingsOwner" in required(facts.publicAccessFacts[0]), false);
  assert.equal("resource" in required(facts.publicAccessFacts[0]), false);
  assert.deepEqual(facts.relationshipIndexes.publicAccessToAp, [
    {
      kind: "PublicAccessToAP",
      source: { kind: "PublicAccess", name: "api", namespace: "default" },
      target: { kind: "AP", name: "api", namespace: "default" },
    },
  ]);
});

test("Project Runtime does not show Public Access accessible while AP is updating", () => {
  const facts = projectRuntimeFactsFromResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "ap-uid" },
          spec: {
            input: {
              network: {
                platformAddresses: [{ id: "pa_abc123", port: 8080 }],
                privatePort: 8080,
              },
            },
          },
          status: {
            network: {
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
            },
            phase: "Updating",
          },
        },
      ],
    },
    namespace: "default",
  });

  assert.deepEqual(facts.publicAccessFacts[0]?.targets[0]?.status, {
    label: "Updating",
    tone: "updating",
  });
});

test("Project Runtime ignores old template-native workload facts", () => {
  const facts = projectRuntimeFactsFromResources({ namespace: "ns-admin" });

  assert.deepEqual(facts.apFacts, []);
  assert.deepEqual(facts.dbFacts, []);
});

test("Project Runtime derives saved AP-to-DB relationship indexes and DB reference sources", () => {
  const facts = projectRuntimeFactsFromResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "ap-uid" },
          spec: {
            input: {
              envRawSource: [
                `DATABASE_URL=${postgresDatabaseUrlReference}`,
                `PGHOST=${postgresHostReference}`,
              ].join("\n"),
            },
          },
          status: { phase: "Running" },
        },
      ],
    },
    dbsData: {
      items: [
        {
          metadata: { name: "postgres", namespace: "default", uid: "db-uid" },
          spec: { engine: "postgresql" },
          status: {
            connectionStringPrivate: "postgres://private",
            variables: [
              {
                name: "PGHOST",
                valueFrom: {
                  secretKeyRef: { key: "host", name: "postgres-conn" },
                },
              },
            ],
          },
        },
      ],
    },
    namespace: "default",
  });

  assert.deepEqual(facts.relationshipIndexes.apToDb, [
    {
      kind: "APToDB",
      source: { kind: "AP", name: "api", namespace: "default" },
      target: { kind: "DB", name: "postgres", namespace: "default" },
    },
  ]);
  assert.deepEqual(facts.relationshipIndexes.apEnvironmentDbReferenceSources, [
    {
      engine: "postgresql",
      name: "postgres",
      namespace: "default",
      primitiveSecretRefs: {
        host: { key: "host", name: "postgres-conn" },
      },
      privateDsn: "postgres://private",
      variables: [
        {
          name: "PGHOST",
          type: "secret",
          valueFrom: {
            secretKeyRef: { key: "host", name: "postgres-conn" },
          },
        },
      ],
    },
  ]);
  assert.equal(
    "resource" in required(facts.relationshipIndexes.apToDb[0]),
    false
  );
  assert.equal("node" in required(facts.relationshipIndexes.apToDb[0]), false);
});

test("Project Runtime store exposes relationship indexes after committing resources", () => {
  const store = createProjectRuntimeStore();

  store.commitResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: {
            input: {
              envRawSource: `DATABASE_URL=${postgresDatabaseUrlReference}`,
            },
          },
        },
      ],
    },
    dbsData: {
      items: [
        {
          metadata: { name: "postgres", namespace: "default" },
          status: { connectionStringPrivate: "postgres://private" },
        },
      ],
    },
    namespace: "default",
  });

  assert.deepEqual(store.selectRelationshipIndexes().apToDb, [
    {
      kind: "APToDB",
      source: { kind: "AP", name: "api", namespace: "default" },
      target: { kind: "DB", name: "postgres", namespace: "default" },
    },
  ]);
});

test("Project Runtime commits one AP update without notifying unrelated models or changing resource topology", () => {
  const store = createProjectRuntimeStore();
  store.commitResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "api-uid" },
          spec: { input: { image: "nginx" }, resource: { replicas: 1 } },
          status: { phase: "Running" },
        },
        {
          metadata: { name: "worker", namespace: "default", uid: "worker-uid" },
          spec: { input: { image: "worker" }, resource: { replicas: 1 } },
          status: { phase: "Running" },
        },
      ],
    },
    namespace: "default",
  });

  const apiKey = "AP:default:api";
  const workerKey = "AP:default:worker";
  const apiBefore = store.selectApFact(apiKey);
  const workerBefore = store.selectApFact(workerKey);
  const resourceTopologyBefore = store.selectResourceTopology();
  const apiNotifications: unknown[] = [];
  const workerNotifications: unknown[] = [];
  store.subscribeApFact(apiKey, (fact) => apiNotifications.push(fact));
  store.subscribeApFact(workerKey, (fact) => workerNotifications.push(fact));

  store.commitResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "api-uid" },
          spec: { input: { image: "nginx" }, resource: { replicas: 1 } },
          status: { phase: "Updating" },
        },
        {
          metadata: { name: "worker", namespace: "default", uid: "worker-uid" },
          spec: { input: { image: "worker" }, resource: { replicas: 1 } },
          status: { phase: "Running" },
        },
      ],
    },
    namespace: "default",
  });

  const apiAfter = store.selectApFact(apiKey);
  assert.notEqual(apiAfter, apiBefore);
  assert.deepEqual(apiAfter?.status, { label: "Updating", tone: "updating" });
  assert.equal(store.selectApFact(workerKey), workerBefore);
  assert.equal(store.selectResourceTopology(), resourceTopologyBefore);
  assert.deepEqual(apiNotifications, [apiAfter]);
  assert.deepEqual(workerNotifications, []);
});

test("Project Runtime propagates an AP replica change into the container node model", () => {
  const store = createProjectRuntimeStore();
  const apWithReplicas = (desired: number, ready: number) => ({
    metadata: { name: "api", namespace: "default", uid: "api-uid" },
    spec: {
      input: { image: "nginx" },
      resource: {
        replicaStrategy: { fixed: { replicas: desired }, type: "fixed" },
        replicas: desired,
      },
    },
    status: { phase: "Running", readyReplicas: ready },
  });
  store.commitResources({
    apsData: { items: [apWithReplicas(1, 1)] },
    namespace: "default",
  });

  const apiKey = "AP:default:api";
  const notifications: unknown[] = [];
  store.subscribeApFact(apiKey, (fact) => notifications.push(fact));

  // Scaled 1 -> 3 while only one pod is ready yet.
  store.commitResources({
    apsData: { items: [apWithReplicas(3, 1)] },
    namespace: "default",
  });

  const fact = required(store.selectApFact(apiKey));
  assert.deepEqual(fact.replicaSummary, { desired: 3, ready: 1 });
  assert.deepEqual(notifications, [fact]);

  const models = projectRuntimeNodeModelsFromFacts({
    apFacts: [fact],
    dbFacts: [],
    publicAccessFacts: [],
    relationshipIndexes: store.selectRelationshipIndexes(),
  });
  const states = required(models.containerModelsByKey.get(apiKey)).states;
  assert.equal(states.replicas, 3);
  assert.equal(states.readyReplicas, 1);
});

test("Project Runtime commits one DB update without notifying unrelated DB models or changing resource topology", () => {
  const store = createProjectRuntimeStore();
  store.commitResources({
    dbsData: {
      items: [
        {
          metadata: {
            labels: { region: "192.168.12.53.nip.io" },
            name: "postgres",
            namespace: "default",
            uid: "pg-uid",
          },
          spec: { engine: "postgresql" },
          status: { phase: "Running" },
        },
        {
          metadata: { name: "redis", namespace: "default", uid: "redis-uid" },
          spec: { engine: "redis" },
          status: { phase: "Running" },
        },
      ],
    },
    namespace: "default",
  });

  const postgresKey = "DB:default:postgres";
  const redisKey = "DB:default:redis";
  const postgresBefore = store.selectDbFact(postgresKey);
  const redisBefore = store.selectDbFact(redisKey);
  const resourceTopologyBefore = store.selectResourceTopology();
  const postgresNotifications: unknown[] = [];
  const redisNotifications: unknown[] = [];
  store.subscribeDbFact(postgresKey, (fact) =>
    postgresNotifications.push(fact)
  );
  store.subscribeDbFact(redisKey, (fact) => redisNotifications.push(fact));

  store.commitResources({
    dbsData: {
      items: [
        {
          metadata: { name: "postgres", namespace: "default", uid: "pg-uid" },
          spec: { engine: "postgresql" },
          status: { phase: "Updating" },
        },
        {
          metadata: { name: "redis", namespace: "default", uid: "redis-uid" },
          spec: { engine: "redis" },
          status: { phase: "Running" },
        },
      ],
    },
    namespace: "default",
  });

  const postgresAfter = store.selectDbFact(postgresKey);
  assert.notEqual(postgresAfter, postgresBefore);
  assert.deepEqual(postgresAfter?.status, {
    label: "Updating",
    tone: "updating",
  });
  assert.equal(store.selectDbFact(redisKey), redisBefore);
  assert.equal(store.selectResourceTopology(), resourceTopologyBefore);
  assert.deepEqual(postgresNotifications, [postgresAfter]);
  assert.deepEqual(redisNotifications, []);
});

test("Project Runtime commits one AP Public Access update without notifying unrelated public access models or changing resource topology", () => {
  const store = createProjectRuntimeStore();
  const apWithPublicAddress = (name: string, status: string) => ({
    metadata: { name, namespace: "default", uid: `${name}-uid` },
    spec: {
      input: {
        network: {
          platformAddresses: [{ id: `pa_${name}`, port: 8080 }],
        },
      },
    },
    status: {
      network: {
        publicAddresses: [
          {
            host: `${name}.example.com`,
            id: `pa_${name}`,
            port: 8080,
            status,
            type: "platform",
            url: `https://${name}.example.com/`,
          },
        ],
      },
      phase: "Running",
    },
  });
  store.commitResources({
    apsData: {
      items: [
        apWithPublicAddress("api", "progressing"),
        apWithPublicAddress("web", "accessible"),
      ],
    },
    namespace: "default",
  });

  const apiKey = "PublicAccess:default:api";
  const webKey = "PublicAccess:default:web";
  const apiBefore = store.selectPublicAccessFact(apiKey);
  const webBefore = store.selectPublicAccessFact(webKey);
  const resourceTopologyBefore = store.selectResourceTopology();
  const apiNotifications: unknown[] = [];
  const webNotifications: unknown[] = [];
  store.subscribePublicAccessFact(apiKey, (fact) =>
    apiNotifications.push(fact)
  );
  store.subscribePublicAccessFact(webKey, (fact) =>
    webNotifications.push(fact)
  );

  store.commitResources({
    apsData: {
      items: [
        apWithPublicAddress("api", "accessible"),
        apWithPublicAddress("web", "accessible"),
      ],
    },
    namespace: "default",
  });

  const apiAfter = store.selectPublicAccessFact(apiKey);
  assert.notEqual(apiAfter, apiBefore);
  assert.deepEqual(apiAfter?.targets[0]?.status, {
    label: "Accessible",
    tone: "accessible",
  });
  assert.equal(store.selectPublicAccessFact(webKey), webBefore);
  assert.equal(store.selectResourceTopology(), resourceTopologyBefore);
  assert.deepEqual(apiNotifications, [apiAfter]);
  assert.deepEqual(webNotifications, []);
});

test("Project Runtime adapts per-node models to shared UI props outside read-side facts", () => {
  const facts = projectRuntimeFactsFromResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "api-uid" },
          spec: { input: { image: "nginx" }, resource: { replicas: 2 } },
          status: { phase: "Running" },
        },
      ],
    },
    dbsData: {
      items: [
        {
          metadata: {
            labels: { region: "192.168.12.53.nip.io" },
            name: "postgres",
            namespace: "default",
            uid: "pg-uid",
          },
          spec: { engine: "postgresql", exposeNodePort: true },
          status: {
            connectionStringPrivate: "postgres://private",
            phase: "Running",
          },
        },
      ],
    },
    namespace: "default",
  });

  const models = projectRuntimeNodeModelsFromFacts(facts);

  assert.deepEqual(models.containerModelsByKey.get("AP:default:api"), {
    resourceKind: "ap",
    states: {
      image: "nginx",
      kind: "AP",
      name: "api",
      namespace: "default",
      replicas: 2,
      status: { label: "Running", tone: "running" },
      uid: "api-uid",
    },
  });
  const databaseModel = required(
    models.databaseModelsByKey.get("DB:default:postgres")
  );
  assert.match(databaseModel.states.iconUrl ?? "", POSTGRESQL_ORIGINAL_ICON_RE);
  assert.deepEqual(databaseModel, {
    connections: [
      {
        id: "private",
        kind: "private",
        label: "Private connection",
        value: "postgres://private",
      },
      {
        id: "public",
        kind: "public",
        label: "Public connection",
        publicAccess: { enabled: true },
      },
    ],
    metadata: { labels: { region: "192.168.12.53.nip.io" } },
    states: {
      displayEngine: "PostgreSQL",
      engineKey: "postgresql",
      iconUrl: databaseModel.states.iconUrl,
      metrics: {},
      name: "postgres",
      status: { label: "Running", tone: "running" },
      uid: "pg-uid",
    },
    uid: "pg-uid",
    workload: { name: "postgres", namespace: "default" },
  });
  assert.equal("states" in required(facts.apFacts[0]), false);
  assert.equal("connections" in required(facts.dbFacts[0]), false);
});
