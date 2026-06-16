import assert from "node:assert/strict";
import { test } from "node:test";

import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";

import {
  isProjectDisplayNameTaken,
  normalizeProjectDisplayName,
  projectDescription,
  projectDisplayName,
  projectItemsFromK8sGetResponse,
  projectsListToExplorerProjects,
} from "./projects-to-explorer-projects";

test("projectDisplayName prefers annotation over legacy title", () => {
  assert.equal(
    projectDisplayName({
      metadata: {
        annotations: {
          displayName: "Production API",
        },
        name: "prod-api",
      },
      spec: {
        title: "Legacy API",
      },
    }),
    "Production API"
  );
});

test("projectDisplayName falls back to legacy title", () => {
  assert.equal(
    projectDisplayName({
      metadata: {
        annotations: {
          displayName: "   ",
        },
        name: "prod-api",
      },
      spec: {
        title: "Legacy API",
      },
    }),
    "Legacy API"
  );
});

test("projectDescription reads non-empty annotation", () => {
  assert.equal(
    projectDescription({
      metadata: {
        annotations: {
          description: "Handles order traffic.",
        },
      },
    }),
    "Handles order traffic."
  );
});

test("projectsListToExplorerProjects falls back to resource name", () => {
  const projects = projectsListToExplorerProjects({
    items: [
      {
        metadata: {
          name: "prod-api",
          uid: "project-uid",
        },
      },
    ],
  } as K8sGetResponse);

  assert.equal(projects[0]?.id, "project-uid");
  assert.equal(projects[0]?.name, "prod-api");
  assert.equal(projects[0]?.resourceName, "prod-api");
});

test("projectItemsFromK8sGetResponse accepts nested data envelope", () => {
  const items = projectItemsFromK8sGetResponse({
    data: {
      items: [
        {
          metadata: {
            name: "prod-api",
            uid: "project-uid",
          },
        },
      ],
    },
  } as K8sGetResponse);

  assert.equal(items?.[0]?.metadata?.uid, "project-uid");
});

test("normalizeProjectDisplayName trims and compares case-insensitively", () => {
  assert.equal(
    normalizeProjectDisplayName("  Production API "),
    "production api"
  );
});

test("isProjectDisplayNameTaken detects namespace display-name conflicts", () => {
  assert.equal(
    isProjectDisplayNameTaken(
      [
        {
          createdAt: "",
          id: "project-1",
          name: "Production API",
        },
      ],
      " production api "
    ),
    true
  );
  assert.equal(
    isProjectDisplayNameTaken(
      [
        {
          createdAt: "",
          id: "project-1",
          name: "Production API",
        },
      ],
      "production api",
      "project-1"
    ),
    false
  );
});
