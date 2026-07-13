import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "bun";

import { main } from "./brain-v1-import.mjs";
import {
  buildInventoryFromSnapshot,
  captureSnapshotFromApi,
  captureSnapshotWithKubeconfig,
  deterministicProjectId,
  SNAPSHOT_DEFINITIONS,
  verifiedKubeconfigContents,
} from "./brain-v1-snapshot.mjs";

const temporaryDirectories = [];
const servers = [];
const API_GROUP_VERSION_PATH_PATTERN = /^\/apis\/([^/]+)\/([^/]+)\//;
const UUID_V5_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "brain-v1-import-"));
  temporaryDirectories.push(directory);
  return directory;
}

function metadata(name, namespace, labels = {}) {
  return {
    creationTimestamp: "2026-01-01T00:00:00Z",
    labels,
    name,
    namespace,
    uid: `${namespace}-${name}`,
  };
}

function apiGroupDiscoveryFixture() {
  const versionsByGroup = new Map();
  for (const definition of SNAPSHOT_DEFINITIONS) {
    const match = definition.path.match(API_GROUP_VERSION_PATH_PATTERN);
    if (!match) {
      continue;
    }
    const [, group, version] = match;
    const versions = versionsByGroup.get(group) ?? new Set();
    versions.add(version);
    versionsByGroup.set(group, versions);
  }
  return {
    groups: [...versionsByGroup].map(([name, versions]) => ({
      name,
      versions: [...versions].map((version) => ({ version })),
    })),
    kind: "APIGroupList",
  };
}

describe("Brain v1 snapshot", () => {
  test("generates deterministic RFC 4122 UUID variants", () => {
    const projectId = deterministicProjectId("ns-test", {
      metadata: { uid: "uid-2" },
    });
    expect(projectId).toMatch(UUID_V5_PATTERN);
    expect(projectId).toHaveLength(36);
  });

  test("refuses to write through a snapshot directory symlink", async () => {
    const outDir = temporaryDirectory();
    const target = temporaryDirectory();
    mkdirSync(target, { recursive: true });
    symlinkSync(target, path.join(outDir, "snapshot-v1"));

    await expect(
      captureSnapshotFromApi({
        baseUrl: "http://127.0.0.1:1/",
        context: "test-context",
        kubeconfig: "/tmp/test-kubeconfig",
        outDir,
        retries: 0,
      })
    ).rejects.toThrow("symbolic link");
  });

  test("keeps inventory and dry-run local-only", async () => {
    await expect(
      main([
        "inventory",
        "--snapshot",
        "/tmp/snapshot-v1",
        "--kubeconfig",
        "/tmp/forbidden",
      ])
    ).rejects.toThrow("inventory is local-only");
    await expect(main(["dry-run"])).rejects.toThrow("--inventory is required");

    const legacyInventory = path.join(
      temporaryDirectory(),
      "legacy-inventory.json"
    );
    writeFileSync(legacyInventory, JSON.stringify({ version: 1 }));
    await expect(
      main(["dry-run", "--inventory", legacyInventory])
    ).rejects.toThrow("Unsupported inventory schema/version");

    const legacyManifest = path.join(
      temporaryDirectory(),
      "legacy-manifest.json"
    );
    writeFileSync(
      legacyManifest,
      JSON.stringify({ mode: "dry-run", projects: [], version: 1 })
    );
    await expect(
      main([
        "rollback",
        "--manifest",
        legacyManifest,
        "--database-url",
        "postgresql://127.0.0.1:1/should-not-connect",
        "--yes",
      ])
    ).rejects.toThrow("Unsupported manifest schema/version");
  });

  test("uses an explicit kubeconfig without opening a local proxy", async () => {
    const requests = [];
    const server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          authorization: request.headers.get("authorization"),
          method: request.method,
          pathname: url.pathname,
        });
        if (url.pathname === "/apis") {
          return Response.json(apiGroupDiscoveryFixture());
        }
        return Response.json({
          items: [],
          kind: url.pathname.endsWith("/instances")
            ? "InstanceList"
            : "PartialObjectMetadataList",
          metadata: { resourceVersion: "fixture-rv" },
        });
      },
    });
    servers.push(server);
    const outDir = temporaryDirectory();
    const kubeconfig = path.join(outDir, "kubeconfig.yaml");
    writeFileSync(
      kubeconfig,
      `apiVersion: v1
kind: Config
clusters:
  - name: local
    cluster:
      server: ${server.url.origin}
      insecure-skip-tls-verify: true
contexts:
  - name: local-context
    context:
      cluster: local
      user: local-user
current-context: local-context
users:
  - name: local-user
    user:
      token: local-test-token
`
    );

    const result = await captureSnapshotWithKubeconfig({
      context: "local-context",
      kubeconfig,
      outDir,
      retries: 0,
    });

    expect(result.manifest.complete).toBe(true);
    expect(requests).toHaveLength(SNAPSHOT_DEFINITIONS.length + 1);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(
      requests.every(
        (request) => request.authorization === "Bearer local-test-token"
      )
    ).toBe(true);
    const frozenKubeconfig = verifiedKubeconfigContents(
      kubeconfig,
      "local-context",
      result.manifest.sourceFingerprint
    );
    expect(
      execFileSync(
        "kubectl",
        ["--kubeconfig", "/dev/stdin", "config", "current-context"],
        { encoding: "utf8", input: frozenKubeconfig }
      ).trim()
    ).toBe("local-context");
  });

  test("captures paginated GET responses locally without persisting Secret data", async () => {
    const requests = [];
    const server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          accept: request.headers.get("accept"),
          method: request.method,
          pathname: url.pathname,
          search: url.search,
        });

        if (url.pathname.endsWith("/instances")) {
          if (url.searchParams.get("continue") === "instances-page-2") {
            return Response.json({
              apiVersion: "app.sealos.io/v1",
              items: [],
              kind: "InstanceList",
              metadata: { resourceVersion: "rv-instances" },
            });
          }
          return Response.json({
            apiVersion: "app.sealos.io/v1",
            items: [
              {
                apiVersion: "app.sealos.io/v1",
                kind: "Instance",
                metadata: metadata("project-a", "ns-a", {
                  "cloud.sealos.io/deploy-on-sealos": "project-a",
                }),
                spec: { title: "Project A" },
              },
            ],
            kind: "InstanceList",
            metadata: {
              continue: "instances-page-2",
              resourceVersion: "rv-instances",
            },
          });
        }

        if (url.pathname.endsWith("/secrets")) {
          return Response.json({
            apiVersion: "meta.k8s.io/v1",
            items: [
              {
                apiVersion: "meta.k8s.io/v1",
                kind: "PartialObjectMetadata",
                metadata: {
                  ...metadata("app-secret", "ns-a", {
                    "cloud.sealos.io/app-deploy-manager": "app-a",
                  }),
                  annotations: { sensitive: "must-not-be-written" },
                },
              },
            ],
            kind: "PartialObjectMetadataList",
            metadata: { resourceVersion: "rv-secrets" },
          });
        }

        return Response.json({
          apiVersion: "meta.k8s.io/v1",
          items: [],
          kind: "PartialObjectMetadataList",
          metadata: { resourceVersion: `rv-${requests.length}` },
        });
      },
    });
    servers.push(server);

    const outDir = temporaryDirectory();
    const result = await captureSnapshotFromApi({
      baseUrl: server.url,
      context: "test-context",
      kubeconfig: "/tmp/test-kubeconfig",
      outDir,
      pageSize: 200,
      requestTimeoutMs: 5000,
      retries: 0,
    });

    expect(result.manifest.complete).toBe(true);
    expect(result.manifest.resources).toHaveLength(SNAPSHOT_DEFINITIONS.length);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(
      requests.filter((request) => request.pathname.endsWith("/instances"))
    ).toHaveLength(2);

    const secretRequest = requests.find((request) =>
      request.pathname.endsWith("/secrets")
    );
    expect(secretRequest.accept).toContain("PartialObjectMetadataList");

    const secretPath = path.join(
      result.snapshotDir,
      "resources",
      "support-secrets.ndjson"
    );
    expect(existsSync(secretPath)).toBe(true);
    const secretSnapshot = readFileSync(secretPath, "utf8");
    expect(secretSnapshot).toContain("app-secret");
    expect(secretSnapshot).not.toContain("must-not-be-written");
    expect(secretSnapshot).not.toContain('"data"');

    const requestCount = requests.length;
    const resumed = await captureSnapshotFromApi({
      baseUrl: server.url,
      context: "test-context",
      kubeconfig: "/tmp/test-kubeconfig",
      outDir,
      pageSize: 200,
      requestTimeoutMs: 5000,
      retries: 0,
    });
    expect(resumed.manifest.complete).toBe(true);
    expect(requests).toHaveLength(requestCount);
  });

  test("fails closed when Secret metadata-only negotiation is ignored", async () => {
    const server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/secrets")) {
          return Response.json({
            apiVersion: "v1",
            items: [
              {
                apiVersion: "v1",
                data: { password: "must-not-be-written" },
                kind: "Secret",
                metadata: metadata("unsafe-secret", "ns-a"),
              },
            ],
            kind: "SecretList",
            metadata: { resourceVersion: "rv-secrets" },
          });
        }
        return Response.json({
          apiVersion: "meta.k8s.io/v1",
          items: [],
          kind: url.pathname.endsWith("/instances")
            ? "InstanceList"
            : "PartialObjectMetadataList",
          metadata: { resourceVersion: "fixture-rv" },
        });
      },
    });
    servers.push(server);

    const outDir = temporaryDirectory();
    await expect(
      captureSnapshotFromApi({
        baseUrl: server.url,
        context: "test-context",
        kubeconfig: "/tmp/test-kubeconfig",
        outDir,
        retries: 0,
      })
    ).rejects.toThrow("metadata-only");

    const secretPath = path.join(
      outDir,
      "snapshot-v1",
      "resources",
      "support-secrets.ndjson"
    );
    expect(existsSync(secretPath)).toBe(false);
  });

  test("accepts a metadata-only empty list with null items", async () => {
    const server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/persistentvolumeclaims")) {
          return Response.json({
            apiVersion: "meta.k8s.io/v1",
            items: null,
            kind: "PartialObjectMetadataList",
            metadata: { resourceVersion: "fixture-rv" },
          });
        }
        return Response.json({
          items: [],
          kind: url.pathname.endsWith("/instances")
            ? "InstanceList"
            : "PartialObjectMetadataList",
          metadata: { resourceVersion: "fixture-rv" },
        });
      },
    });
    servers.push(server);

    const result = await captureSnapshotFromApi({
      baseUrl: server.url,
      outDir: temporaryDirectory(),
      retries: 0,
    });
    expect(
      result.manifest.resources.find(
        (resource) => resource.id === "support-persistentvolumeclaims"
      )?.count
    ).toBe(0);
  });

  test("restarts one resource type when a pagination token expires", async () => {
    let instanceStartRequests = 0;
    let expired = false;
    const server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/instances")) {
          const continueToken = url.searchParams.get("continue");
          if (continueToken === "expired-page" && !expired) {
            expired = true;
            return new Response("expired", { status: 410 });
          }
          instanceStartRequests += 1;
          const name = expired ? "new-snapshot" : "old-snapshot";
          return Response.json({
            items: [
              {
                metadata: metadata(name, "ns-a", {
                  "cloud.sealos.io/deploy-on-sealos": name,
                }),
              },
            ],
            kind: "InstanceList",
            metadata: {
              ...(expired ? {} : { continue: "expired-page" }),
              resourceVersion: expired ? "rv-new" : "rv-old",
            },
          });
        }
        return Response.json({
          items: [],
          kind: "PartialObjectMetadataList",
          metadata: { resourceVersion: "fixture-rv" },
        });
      },
    });
    servers.push(server);

    const outDir = temporaryDirectory();
    const result = await captureSnapshotFromApi({
      baseUrl: server.url,
      context: "test-context",
      kubeconfig: "/tmp/test-kubeconfig",
      outDir,
      retries: 0,
    });
    const instances = readFileSync(
      path.join(result.snapshotDir, "resources", "instances.ndjson"),
      "utf8"
    );
    expect(instanceStartRequests).toBe(2);
    expect(instances).toContain("new-snapshot");
    expect(instances).not.toContain("old-snapshot");
  });

  test("builds an offline inventory from explicit migration eligibility", async () => {
    const instanceNames = [
      "project-ap",
      "project-db",
      "shortcut-app",
      "out-of-scope",
      "review-config",
    ];
    const server = serve({
      hostname: "127.0.0.1",
      port: 0,
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the branches model distinct Kubernetes list endpoints in one local fixture server
      fetch(request) {
        const url = new URL(request.url);
        const metadataOnly = !url.pathname.endsWith("/instances");
        const list = (items) =>
          Response.json({
            items: metadataOnly
              ? items.map((item) => ({
                  ...item,
                  apiVersion: "meta.k8s.io/v1",
                  kind: "PartialObjectMetadata",
                }))
              : items,
            kind: metadataOnly ? "PartialObjectMetadataList" : "InstanceList",
            metadata: { resourceVersion: "fixture-rv" },
          });

        if (url.pathname.endsWith("/instances")) {
          return list(
            instanceNames.map((name) => ({
              metadata: metadata(name, "ns-a", {
                "cloud.sealos.io/deploy-on-sealos": name,
              }),
              spec: { title: name },
            }))
          );
        }
        if (url.pathname.endsWith("/deployments")) {
          return list([
            {
              metadata: metadata("app-a", "ns-a", {
                "cloud.sealos.io/app-deploy-manager": "app-a",
                "cloud.sealos.io/deploy-on-sealos": "project-ap",
              }),
            },
          ]);
        }
        if (url.pathname.endsWith("/clusters")) {
          return list([
            {
              metadata: metadata("db-a", "ns-a", {
                "cloud.sealos.io/deploy-on-sealos": "project-db",
              }),
            },
          ]);
        }
        if (url.pathname.endsWith("/apps")) {
          return list([
            {
              metadata: metadata("shortcut-app", "ns-a", {
                "cloud.sealos.io/deploy-on-sealos": "shortcut-app",
              }),
            },
          ]);
        }
        if (url.pathname.endsWith("/objectstoragebuckets")) {
          return list([
            {
              metadata: metadata("bucket-a", "ns-a", {
                "cloud.sealos.io/deploy-on-sealos": "project-ap",
              }),
            },
          ]);
        }
        if (
          url.pathname.endsWith("/configmaps") &&
          url.searchParams.get("labelSelector") ===
            "cloud.sealos.io/deploy-on-sealos"
        ) {
          return list([
            {
              metadata: metadata("review-config", "ns-a", {
                "cloud.sealos.io/deploy-on-sealos": "review-config",
              }),
            },
          ]);
        }
        if (url.pathname.endsWith("/services")) {
          return list([
            {
              metadata: metadata("app-a", "ns-a", {
                "cloud.sealos.io/app-deploy-manager": "app-a",
              }),
            },
          ]);
        }
        return list([]);
      },
    });
    servers.push(server);

    const outDir = temporaryDirectory();
    const snapshot = await captureSnapshotFromApi({
      baseUrl: server.url,
      context: "test-context",
      kubeconfig: "/tmp/test-kubeconfig",
      outDir,
      retries: 0,
    });
    const result = await buildInventoryFromSnapshot({
      outDir,
      snapshotDir: snapshot.snapshotDir,
    });

    expect(result.inventory.projects).toHaveLength(2);
    expect(
      result.inventory.projects.map((project) => project.displayName).sort()
    ).toEqual(["project-ap", "project-db"]);
    expect(result.report.summary).toEqual({
      eligible: 2,
      eligibleWithReview: 1,
      excluded: 2,
      manualReview: 1,
      resolvedDecisions: 0,
      totalCandidates: 5,
    });
    expect(result.report.excluded.map((entry) => entry.reason).sort()).toEqual([
      "app-crd-only",
      "no-v2-members",
    ]);
    expect(result.report.manualReview[0].reason).toBe(
      "unsupported-member-shape"
    );
    expect(result.report.eligibleWithReview).toEqual([
      expect.objectContaining({
        reason: "v2-members-with-object-storage-review",
      }),
    ]);
    expect(existsSync(path.join(snapshot.snapshotDir, "index.sqlite"))).toBe(
      true
    );

    const decisionsPath = path.join(outDir, "classification-decisions.json");
    writeFileSync(
      decisionsPath,
      JSON.stringify({
        decisions: [
          {
            classificationHash:
              result.report.manualReview[0].classificationHash,
            decision: "exclude",
            note: "confirmed unsupported test fixture",
            projectId: result.report.manualReview[0].projectId,
          },
          {
            classificationHash: result.report.eligibleProjects.find(
              (entry) => entry.displayName === "project-db"
            ).classificationHash,
            decision: "exclude",
            note: "business owner does not need this eligible project",
            projectId: result.report.eligibleProjects.find(
              (entry) => entry.displayName === "project-db"
            ).projectId,
          },
        ],
        schema: "brain-v1-classification-decisions/v1",
        version: 1,
      })
    );
    const resolved = await buildInventoryFromSnapshot({
      decisionsPath,
      outDir,
      snapshotDir: snapshot.snapshotDir,
    });
    expect(resolved.report.summary.manualReview).toBe(0);
    expect(resolved.report.resolvedDecisions).toHaveLength(2);
    expect(
      resolved.inventory.projects.map((entry) => entry.displayName)
    ).toEqual(["project-ap"]);

    const dryRunDir = temporaryDirectory();
    const inventoryPath = path.join(dryRunDir, "inventory.json");
    writeFileSync(inventoryPath, JSON.stringify(resolved.inventory));
    await main(["dry-run", "--inventory", inventoryPath, "--out", dryRunDir]);
    const migrationManifest = JSON.parse(
      readFileSync(path.join(dryRunDir, "migration-manifest.json"), "utf8")
    );
    expect(migrationManifest.sourceFingerprint).toBe(
      snapshot.manifest.sourceFingerprint
    );
    expect(
      migrationManifest.projects.every((project) =>
        project.patches.some(
          (patch) =>
            patch.resource.kind === "Instance" &&
            patch.addedLabels["brain.io/deployment-kind"] === "template"
        )
      )
    ).toBe(true);

    const staleDecisions = JSON.parse(readFileSync(decisionsPath, "utf8"));
    staleDecisions.decisions[0].classificationHash = "0".repeat(64);
    writeFileSync(decisionsPath, JSON.stringify(staleDecisions));
    await expect(
      buildInventoryFromSnapshot({
        decisionsPath,
        outDir,
        snapshotDir: snapshot.snapshotDir,
      })
    ).rejects.toThrow("Stale classification decision");

    const snapshotManifestPath = path.join(
      snapshot.snapshotDir,
      "snapshot-manifest.json"
    );
    const snapshotManifest = JSON.parse(
      readFileSync(snapshotManifestPath, "utf8")
    );
    snapshotManifest.resources[0].file = "../outside.ndjson";
    writeFileSync(snapshotManifestPath, JSON.stringify(snapshotManifest));
    await expect(
      buildInventoryFromSnapshot({
        outDir,
        snapshotDir: snapshot.snapshotDir,
      })
    ).rejects.toThrow("unexpected snapshot resource path");
  });

  test("fails when a required Kubernetes API is missing", async () => {
    const server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/instances")) {
          return new Response("not found", { status: 404 });
        }
        return Response.json({
          items: [],
          kind: "PartialObjectMetadataList",
          metadata: { resourceVersion: "fixture-rv" },
        });
      },
    });
    servers.push(server);

    await expect(
      captureSnapshotFromApi({
        baseUrl: server.url,
        outDir: temporaryDirectory(),
        retries: 0,
      })
    ).rejects.toThrow("required Kubernetes API");
  });

  test("fails if an optional API disappears during pagination", async () => {
    const server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/apps")) {
          if (url.searchParams.has("continue")) {
            return new Response("not found", { status: 404 });
          }
          return Response.json({
            items: [
              {
                kind: "PartialObjectMetadata",
                metadata: metadata("app-a", "ns-a"),
              },
            ],
            kind: "PartialObjectMetadataList",
            metadata: {
              continue: "next-page",
              resourceVersion: "fixture-rv",
            },
          });
        }
        return Response.json({
          items: [],
          kind: url.pathname.endsWith("/instances")
            ? "InstanceList"
            : "PartialObjectMetadataList",
          metadata: { resourceVersion: "fixture-rv" },
        });
      },
    });
    servers.push(server);

    await expect(
      captureSnapshotFromApi({
        baseUrl: server.url,
        outDir: temporaryDirectory(),
        retries: 0,
      })
    ).rejects.toThrow("disappeared during pagination");
  });

  test("does not retry authorization failures", async () => {
    let requests = 0;
    await expect(
      captureSnapshotFromApi({
        baseUrl: "http://127.0.0.1/",
        fetchImpl() {
          requests += 1;
          return Promise.resolve(new Response("forbidden", { status: 403 }));
        },
        outDir: temporaryDirectory(),
        retries: 1,
      })
    ).rejects.toThrow("403");
    expect(requests).toBe(1);
  });

  test("rejects apply before database access when kubeconfig source changed", async () => {
    const outDir = temporaryDirectory();
    const kubeconfig = path.join(outDir, "kubeconfig.yaml");
    writeFileSync(
      kubeconfig,
      `apiVersion: v1
kind: Config
clusters:
  - name: local
    cluster:
      server: http://127.0.0.1:1
contexts:
  - name: local-context
    context:
      cluster: local
      user: local-user
current-context: local-context
users:
  - name: local-user
    user:
      token: local-test-token
`
    );
    const manifestPath = path.join(outDir, "migration-manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        context: "local-context",
        kubeconfig,
        mode: "dry-run",
        projects: [],
        schema: "brain-v1-migration/v2",
        sourceFingerprint: "0".repeat(64),
        version: 2,
      })
    );

    await expect(
      main([
        "apply",
        "--manifest",
        manifestPath,
        "--database-url",
        "postgresql://127.0.0.1:1/should-not-connect",
        "--yes",
      ])
    ).rejects.toThrow("source fingerprint");
  });

  test("fails when resourceVersion changes between pages", async () => {
    const server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/instances")) {
          const continued = url.searchParams.has("continue");
          return Response.json({
            items: [],
            kind: "InstanceList",
            metadata: {
              ...(continued ? {} : { continue: "next-page" }),
              resourceVersion: continued ? "rv-2" : "rv-1",
            },
          });
        }
        return Response.json({
          items: [],
          kind: "PartialObjectMetadataList",
          metadata: { resourceVersion: "fixture-rv" },
        });
      },
    });
    servers.push(server);

    await expect(
      captureSnapshotFromApi({
        baseUrl: server.url,
        outDir: temporaryDirectory(),
        retries: 0,
      })
    ).rejects.toThrow("resourceVersion changed");
  });
});
