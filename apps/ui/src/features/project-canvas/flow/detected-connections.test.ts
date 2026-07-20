import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectCanvasConnections,
  detectedCanvasConnectionEdges,
} from "./detected-connections";

function referenceExpression(db: string, variable: string): string {
  return ["$", "{{", db, ".", variable, "}}"].join("");
}

test("canvas connections detect AP to DB edges from exact DB DSN env values and de-duplicate each pair", () => {
  const apsData = {
    items: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: {
          input: {
            env: [
              { name: "DATABASE_URL", value: "postgres://private" },
              { name: "DATABASE_PUBLIC_URL", value: "postgres://public" },
              { name: "ALMOST_DATABASE_URL", value: "postgres://private " },
            ],
          },
        },
      },
    ],
  };
  const dbsData = {
    items: [
      {
        metadata: { name: "postgres", namespace: "default" },
        status: {
          connectionStringPrivate: "postgres://private",
          connectionStringPublic: "postgres://public",
        },
      },
    ],
  };

  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData,
    }),
    [
      {
        kind: "APToDB",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ]
  );
});

test("canvas connections stay resource-backed when DB public access desired state changes", () => {
  const apsData = {
    items: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: {
          input: {
            env: [
              { name: "DATABASE_URL", value: "postgres://private" },
              { name: "DATABASE_PUBLIC_URL", value: "postgres://public" },
            ],
          },
        },
      },
    ],
  };

  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData: {
        items: [
          {
            metadata: { name: "postgres", namespace: "default" },
            spec: { exposeNodePort: false },
            status: { connectionStringPrivate: "postgres://private" },
          },
        ],
      },
    }),
    [
      {
        kind: "APToDB",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ]
  );

  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData: {
        items: [
          {
            metadata: { name: "postgres", namespace: "default" },
            spec: { exposeNodePort: true },
            status: { connectionStringPrivate: "postgres://private" },
          },
        ],
      },
    }),
    [
      {
        kind: "APToDB",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ]
  );
});

test("canvas connections detect public DB bindings only after resource status has a public DSN", () => {
  const apsData = {
    items: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: {
          input: {
            env: [{ name: "DATABASE_URL", value: "postgres://public" }],
          },
        },
      },
    ],
  };

  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData: {
        items: [
          {
            metadata: { name: "postgres", namespace: "default" },
            spec: { exposeNodePort: true },
            status: { connectionStringPrivate: "postgres://private" },
          },
        ],
      },
    }),
    []
  );

  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData: {
        items: [
          {
            metadata: { name: "postgres", namespace: "default" },
            spec: { exposeNodePort: true },
            status: {
              connectionStringPrivate: "postgres://private",
              connectionStringPublic: "postgres://public",
            },
          },
        ],
      },
    }),
    [
      {
        kind: "APToDB",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ]
  );
});

test("canvas connections match pasted DSN env values against DB Connection Templates by address", () => {
  const apsData = {
    items: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: {
          input: {
            env: [
              {
                name: "DATABASE_URL",
                value:
                  "postgresql://alice:s3cr3t@postgres-postgresql.default.svc:5432/postgres",
              },
            ],
          },
        },
      },
    ],
  };
  const dbsData = {
    items: [
      {
        metadata: { name: "postgres", namespace: "default" },
        status: {
          connectionStringPrivate:
            "postgresql://<username>:<password>@postgres-postgresql.default.svc:5432/postgres",
        },
      },
    ],
  };

  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData,
    }),
    [
      {
        kind: "APToDB",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ]
  );
});

test("canvas connections keep pasted DSN edges across a DB password rotation", () => {
  const apsData = {
    items: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: {
          input: {
            env: [
              {
                name: "DATABASE_URL",
                value:
                  "postgresql://alice:stale-password@postgres-postgresql.default.svc:5432/postgres",
              },
            ],
          },
        },
      },
    ],
  };
  const dbsData = {
    items: [
      {
        metadata: { name: "postgres", namespace: "default" },
        status: {
          connectionStringPrivate:
            "postgresql://alice:rotated-password@postgres-postgresql.default.svc:5432/postgres",
        },
      },
    ],
  };

  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData,
    }),
    [
      {
        kind: "APToDB",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ]
  );
});

test("canvas connections do not match DSN env values against unrelated addresses", () => {
  const apsData = {
    items: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: {
          input: {
            env: [
              {
                name: "DATABASE_URL",
                value: "postgresql://alice:s3cr3t@db.external.example:5432/app",
              },
              {
                name: "OTHER_PORT_URL",
                value:
                  "postgresql://alice:s3cr3t@postgres-postgresql.default.svc:5433/postgres",
              },
              {
                name: "OTHER_SCHEME_URL",
                value:
                  "mysql://alice:s3cr3t@postgres-postgresql.default.svc:5432/postgres",
              },
              { name: "NOT_A_URL", value: "plain-text" },
            ],
          },
        },
      },
    ],
  };
  const dbsData = {
    items: [
      {
        metadata: { name: "postgres", namespace: "default" },
        status: {
          connectionStringPrivate:
            "postgresql://<username>:<password>@postgres-postgresql.default.svc:5432/postgres",
        },
      },
    ],
  };

  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData,
    }),
    []
  );
});

test("canvas connections detect primitive Secret-backed AP to DB edges and de-duplicate each pair", () => {
  const apsData = {
    items: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: {
          input: {
            env: [
              {
                name: "DATABASE_USER",
                valueFrom: {
                  secretKeyRef: {
                    key: "user",
                    name: "postgres-conn-credential",
                  },
                },
              },
              {
                name: "DATABASE_PASSWORD",
                valueFrom: {
                  secretKeyRef: {
                    key: "passwd",
                    name: "postgres-conn-credential",
                  },
                },
              },
              {
                name: "EXTERNAL_PASSWORD",
                valueFrom: {
                  secretKeyRef: {
                    key: "passwd",
                    name: "external-db",
                  },
                },
              },
            ],
          },
        },
      },
    ],
  };
  const dbsData = {
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
            {
              name: "PG_PASSWORD",
              valueFrom: {
                secretKeyRef: {
                  key: "passwd",
                  name: "postgres-conn-credential",
                },
              },
            },
          ],
        },
      },
    ],
  };

  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData,
    }),
    [
      {
        kind: "APToDB",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ]
  );
});

test("canvas connections prefer raw source DB references for AP to DB edges", () => {
  const apsData = {
    items: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: {
          input: {
            env: [{ name: "DATABASE_URL", value: "https://unrelated" }],
            envRawSource: `DATABASE_URL=${referenceExpression(
              "postgres",
              "DATABASE_URL"
            )}`,
          },
        },
      },
    ],
  };
  const dbsData = {
    items: [
      {
        metadata: { name: "postgres", namespace: "default" },
        status: {
          variables: [
            {
              name: "PG_PASSWORD",
              valueFrom: {
                secretKeyRef: {
                  key: "passwd",
                  name: "postgres-conn-credential",
                },
              },
            },
          ],
        },
      },
    ],
  };

  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData,
    }),
    [
      {
        kind: "APToDB",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ]
  );
});

test("canvas connections ignore primitive Secret refs with non-matching names or keys", () => {
  const dbsData = {
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
  };

  assert.deepEqual(
    detectCanvasConnections({
      apsData: {
        items: [
          {
            metadata: { name: "api", namespace: "default" },
            spec: {
              input: {
                env: [
                  {
                    name: "EXTERNAL_USER",
                    valueFrom: {
                      secretKeyRef: { key: "user", name: "external-db" },
                    },
                  },
                  {
                    name: "DATABASE_NAME",
                    valueFrom: {
                      secretKeyRef: {
                        key: "database",
                        name: "postgres-conn-credential",
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      dbsData,
    }),
    []
  );
});

test("canvas connections keep PublicAccess-to-AP detection alongside AP-to-DB detection", () => {
  const apsData = {
    items: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: {
          input: {
            env: [
              {
                name: "DATABASE_URL",
                value: "postgres://private",
              },
            ],
            network: {
              platformAddresses: [{ id: "pa_abc123", port: 8080 }],
            },
          },
        },
      },
    ],
  };
  const dbsData = {
    items: [
      {
        metadata: { name: "postgres", namespace: "default" },
        status: { connectionStringPrivate: "postgres://private" },
      },
    ],
  };
  assert.deepEqual(
    detectCanvasConnections({
      apsData,
      dbsData,
    }),
    [
      {
        kind: "PublicAccessToAP",
        source: { kind: "PublicAccess", name: "api", namespace: "default" },
        target: { kind: "AP", name: "api", namespace: "default" },
      },
      {
        kind: "APToDB",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ]
  );
});

test("canvas connection edges include DSN-backed AP to DB connections", () => {
  const apsData = {
    items: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: { input: { env: [{ name: "DATABASE_URL", value: "pg://db" }] } },
      },
    ],
  };
  const dbsData = {
    items: [
      {
        metadata: { name: "postgres", namespace: "default" },
        status: { connectionStringPrivate: "pg://db" },
      },
    ],
  };

  assert.deepEqual(
    detectedCanvasConnectionEdges({
      apsData,
      dbsData,
      nodes: [
        {
          data: { states: { name: "api", namespace: "default" } },
          id: "ap-api",
          position: { x: 0, y: 0 },
          type: "containerNode",
        },
        {
          data: { workload: { name: "postgres", namespace: "default" } },
          id: "db-postgres",
          position: { x: 0, y: 0 },
          type: "databaseNode",
        },
      ],
    }),
    [
      {
        id: "detected:AP:default:api->DB:default:postgres",
        source: "ap-api",
        target: "db-postgres",
      },
    ]
  );
});
