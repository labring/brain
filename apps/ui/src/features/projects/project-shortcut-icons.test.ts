import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectShortcutIconAssetUrls,
  projectShortcutIconKeysFromWorkloads,
} from "./project-shortcut-icons";

function resource({
  createdAt,
  engine,
  name,
  projectId,
}: {
  createdAt: string;
  engine?: string;
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
    spec: engine === undefined ? {} : { engine },
  };
}

test("project shortcut icons prefer AP presence over DB engine icons", () => {
  const iconKeys = projectShortcutIconKeysFromWorkloads({
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

test("project shortcut icons use the earliest DB engine when no AP exists", () => {
  const iconKeys = projectShortcutIconKeysFromWorkloads({
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

test("project shortcut icons use a generic database for an unknown DB engine", () => {
  const iconKeys = projectShortcutIconKeysFromWorkloads({
    aps: undefined,
    dbs: {
      items: [
        resource({
          createdAt: "2026-05-26T01:00:00.000Z",
          engine: "clickhouse",
          name: "analytics",
          projectId: "project-a",
        }),
      ],
    },
  });

  assert.equal(iconKeys.get("project-a"), "database");
});

test("project shortcut icon asset URLs include plain and original variants", () => {
  const urls = projectShortcutIconAssetUrls(["mysql"]);

  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => url.includes("mysql")));
});
