import assert from "node:assert/strict";
import { test } from "node:test";

import { projectIconKeysFromWorkloads } from "./project-icons";

function resource({
  createdAt,
  engine,
  image,
  name,
  projectId,
}: {
  createdAt: string;
  engine?: string;
  image?: string;
  name: string;
  projectId: string;
}) {
  return {
    metadata: {
      creationTimestamp: createdAt,
      labels: {
        "brain.io/project-id": projectId,
      },
      name,
    },
    spec: {
      ...(engine === undefined ? {} : { engine }),
      ...(image === undefined ? {} : { input: { image } }),
    },
  };
}

test("project icons use the brand of a recognized AP image", () => {
  const iconKeys = projectIconKeysFromWorkloads({
    aps: {
      items: [
        resource({
          createdAt: "2026-05-26T01:00:00.000Z",
          image: "nginx:1.27",
          name: "web",
          projectId: "project-a",
        }),
      ],
    },
    dbs: undefined,
  });

  assert.equal(iconKeys.get("project-a"), "nginx");
});

test("project icons strip registry, tag, and digest before matching", () => {
  const iconKeys = projectIconKeysFromWorkloads({
    aps: {
      items: [
        resource({
          createdAt: "2026-05-26T01:00:00.000Z",
          image: "ghcr.io/louislam/uptime-kuma:1@sha256:abc123",
          name: "status",
          projectId: "project-a",
        }),
      ],
    },
    dbs: undefined,
  });

  assert.equal(iconKeys.get("project-a"), "uptimekuma");
});

test("project icons fall back to docker for an unrecognized AP image", () => {
  const iconKeys = projectIconKeysFromWorkloads({
    aps: {
      items: [
        resource({
          createdAt: "2026-05-26T01:00:00.000Z",
          image: "ghcr.io/acme/internal-api:2.3",
          name: "api",
          projectId: "project-a",
        }),
      ],
    },
    dbs: undefined,
  });

  assert.equal(iconKeys.get("project-a"), "docker");
});

test("project icons prefer AP presence over DB engine icons", () => {
  const iconKeys = projectIconKeysFromWorkloads({
    aps: {
      items: [
        resource({
          createdAt: "2026-05-26T01:00:00.000Z",
          name: "api",
          projectId: "project-a",
        }),
      ],
    },
    dbs: {
      items: [
        resource({
          createdAt: "2026-05-26T00:00:00.000Z",
          engine: "mysql",
          name: "db",
          projectId: "project-a",
        }),
      ],
    },
  });

  assert.equal(iconKeys.get("project-a"), "docker");
});

test("project icons use the earliest DB engine when no AP exists", () => {
  const iconKeys = projectIconKeysFromWorkloads({
    aps: undefined,
    dbs: {
      items: [
        resource({
          createdAt: "2026-05-26T02:00:00.000Z",
          engine: "redis",
          name: "cache",
          projectId: "project-a",
        }),
        resource({
          createdAt: "2026-05-26T01:00:00.000Z",
          engine: "postgresql",
          name: "db",
          projectId: "project-a",
        }),
      ],
    },
  });

  assert.equal(iconKeys.get("project-a"), "postgresql");
});

test("project icons use a generic database for an unknown DB engine", () => {
  const iconKeys = projectIconKeysFromWorkloads({
    aps: undefined,
    dbs: {
      items: [
        resource({
          createdAt: "2026-05-26T01:00:00.000Z",
          engine: "cockroachdb",
          name: "analytics",
          projectId: "project-a",
        }),
      ],
    },
  });

  assert.equal(iconKeys.get("project-a"), "database");
});
