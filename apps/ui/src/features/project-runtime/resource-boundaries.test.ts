import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
  CanvasEntryNodeData,
} from "@/features/project-canvas/nodes/types";
import { createProjectCanvasSurfaceRenderModel } from "@/features/project-canvas/surface/rendering-adapter";
import type { ProjectSurfaceState } from "@/features/project-surfaces/surface-state";
import type {
  ApFact,
  DbFact,
  PublicAccessFact,
  TemplateNativeWorkloadFact,
} from "./resource-facts";
import { projectRuntimeFactsFromResources } from "./resource-facts";
import { projectRuntimeShellNodesFromFacts } from "./resource-store";

type AssertFalse<T extends false> = T;
type Extends<T, U> = [T] extends [U] ? true : false;

export type RuntimeFactsDoNotUseSharedUiNodeProps = [
  AssertFalse<Extends<ApFact, CanvasContainerNodeData>>,
  AssertFalse<Extends<DbFact, CanvasDatabaseNodeData>>,
  AssertFalse<Extends<PublicAccessFact, CanvasEntryNodeData>>,
  AssertFalse<Extends<TemplateNativeWorkloadFact, CanvasContainerNodeData>>,
];

const BANNED_SHELL_DATA_KEYS = [
  "actions",
  "connections",
  "databaseData",
  "dbReferenceSources",
  "desired",
  "editableResource",
  "lifecycleActions",
  "onAddPendingDbBinding",
  "onOpenSettings",
  "pendingDbBinding",
  "quickActions",
  "raw",
  "resource",
  "settings",
  "settingsSource",
  "settingsSourceData",
  "states",
  "targets",
  "workload",
] as const;

test("Project Runtime shell node data carries only runtime lookup data", () => {
  const runtimeFacts = projectRuntimeFactsFromResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "ap-uid" },
          spec: {
            input: {
              image: "nginx",
              network: {
                platformAddresses: [{ id: "pa_api", port: 8080 }],
              },
            },
          },
          status: {
            network: {
              publicAddresses: [
                {
                  id: "pa_api",
                  port: 8080,
                  status: "accessible",
                  type: "platform",
                  url: "https://api.example.com/",
                },
              ],
            },
            phase: "Running",
          },
        },
      ],
    },
    dbsData: {
      items: [
        {
          metadata: { name: "postgres", namespace: "default", uid: "db-uid" },
          spec: { engine: "postgresql", exposeNodePort: true },
          status: {
            connectionStringPrivate: "postgres://private",
            connectionStringPublic: "postgres://public",
            phase: "Running",
          },
        },
      ],
    },
    namespace: "default",
    templateNativeData: {
      deployments: {
        items: [
          {
            kind: "Deployment",
            metadata: {
              labels: { "brain.io/deployment-kind": "template" },
              name: "memos",
              namespace: "default",
            },
            spec: { template: { spec: { containers: [{ image: "memos" }] } } },
          },
        ],
      },
    },
  });

  const nodes = projectRuntimeShellNodesFromFacts(runtimeFacts);

  assert.equal(nodes.length, 4);
  for (const node of nodes) {
    assert.deepEqual(Object.keys(node.data).sort(), ["runtime"]);
    for (const key of BANNED_SHELL_DATA_KEYS) {
      assert.equal(key in node.data, false, `${node.id} leaked ${key}`);
    }
  }
});

test("Settings surface entries resolve without constructing source context from ReactFlow node data", () => {
  const surfaceState: ProjectSurfaceState = {
    drawer: null,
    main: null,
    side: {
      kind: "settings",
      target: { kind: "DB", name: "postgres", namespace: "default" },
    },
  };
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [],
    surfaceState,
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected settings side render model");
  }
  assert.equal(model.side.content.kind, "settings");
  assert.equal(model.side.content.node, null);
  assert.equal(model.side.content.databaseData, undefined);
  assert.deepEqual(model.side.content.target.target, {
    kind: "DB",
    name: "postgres",
    namespace: "default",
  });
});

test("legacy full resource snapshot builder is not available as a runtime entry point", () => {
  const hookSource = readFileSync(
    new URL(
      "../project-canvas/snapshot/use-project-canvas-resource-snapshot.ts",
      import.meta.url
    ),
    "utf8"
  );

  assert.equal(
    hookSource.includes("buildProjectCanvasResourceSnapshot"),
    false
  );
  assert.equal(hookSource.includes("./resource-snapshot"), false);
});

test("real Project Canvas path provides runtime store instead of a whole node model map", () => {
  const hookSource = readFileSync(
    new URL(
      "../project-canvas/snapshot/use-project-canvas-resource-snapshot.ts",
      import.meta.url
    ),
    "utf8"
  );
  const pageSource = readFileSync(
    new URL("../../app/project/[uid]/page.tsx", import.meta.url),
    "utf8"
  );

  assert.equal(hookSource.includes("projectRuntimeNodeModelsFromFacts"), false);
  assert.equal(hookSource.includes("runtimeNodeModels"), false);
  assert.equal(pageSource.includes("ProjectRuntimeNodeModelsProvider"), false);
  assert.equal(pageSource.includes("runtimeNodeModels"), false);
  assert.equal(pageSource.includes("ProjectRuntimeStoreProvider"), true);
});
