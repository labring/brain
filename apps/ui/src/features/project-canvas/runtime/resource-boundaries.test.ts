import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ProjectSurfaceState } from "@/features/panes/surface-state";
import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
  CanvasEntryNodeData,
} from "@/features/project-canvas/nodes/types";
import { projectCanvasRuntimeShellNodesFromResources } from "@/features/project-canvas/runtime/resource-graph";
import { createProjectCanvasSurfaceRenderModel } from "@/features/project-canvas/surface/rendering-adapter";
import type { ApFact, DbFact, PublicAccessFact } from "./resource-facts";
import { projectRuntimeFactsFromResources } from "./resource-facts";
import { projectRuntimeFallbackNodeModelFromLookup } from "./resource-models";
import { projectRuntimeResourceTopologyFromFacts } from "./resource-store";

type AssertFalse<T extends false> = T;
type Extends<T, U> = [T] extends [U] ? true : false;

export type RuntimeFactsDoNotUseSharedUiNodeProps = [
  AssertFalse<Extends<ApFact, CanvasContainerNodeData>>,
  AssertFalse<Extends<DbFact, CanvasDatabaseNodeData>>,
  AssertFalse<Extends<PublicAccessFact, CanvasEntryNodeData>>,
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
  });

  const nodes = projectCanvasRuntimeShellNodesFromResources(
    projectRuntimeResourceTopologyFromFacts(runtimeFacts)
  );

  assert.equal(nodes.length, 3);
  for (const node of nodes) {
    assert.deepEqual(Object.keys(node.data).sort(), ["runtime"]);
    for (const key of BANNED_SHELL_DATA_KEYS) {
      assert.equal(key in node.data, false, `${node.id} leaked ${key}`);
    }
  }
});

test("Project Runtime shell lookup can render a minimal model before facts hydrate", () => {
  const runtimeFacts = projectRuntimeFactsFromResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "ap-uid" },
          spec: { input: { image: "nginx" } },
          status: { phase: "Running" },
        },
      ],
    },
    namespace: "default",
  });

  const shellNodes = projectCanvasRuntimeShellNodesFromResources(
    projectRuntimeResourceTopologyFromFacts(runtimeFacts)
  );
  const apLookup = shellNodes.find((node) => node.id === "ap-api")?.data
    .runtime;

  assert.deepEqual(projectRuntimeFallbackNodeModelFromLookup(apLookup), {
    resourceKind: "ap",
    states: {
      image: "—",
      kind: "AP",
      name: "api",
      namespace: "default",
      status: { label: "Loading", tone: "pending" },
      uid: "ap-uid",
    },
  });
  assert.equal(
    shellNodes.some((node) => node.id.startsWith("template-")),
    false
  );
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
      "../snapshot/use-project-canvas-resource-snapshot.ts",
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
      "../snapshot/use-project-canvas-resource-snapshot.ts",
      import.meta.url
    ),
    "utf8"
  );
  const shellSource = readFileSync(
    new URL("../workbench/project-canvas-page-shell.tsx", import.meta.url),
    "utf8"
  );

  assert.equal(hookSource.includes("projectRuntimeNodeModelsFromFacts"), false);
  assert.equal(hookSource.includes("runtimeNodeModels"), false);
  assert.equal(shellSource.includes("ProjectRuntimeNodeModelsProvider"), false);
  assert.equal(shellSource.includes("runtimeNodeModels"), false);
  assert.equal(shellSource.includes("ProjectRuntimeStoreProvider"), true);
});

test("Project Runtime store does not own ReactFlow shell topology", () => {
  const storeSource = readFileSync(
    new URL("./resource-store.ts", import.meta.url),
    "utf8"
  );

  assert.equal(storeSource.includes("@xyflow/react"), false);
  assert.equal(storeSource.includes("selectShellNodes"), false);
  assert.equal(storeSource.includes("subscribeShellNodes"), false);
  assert.equal(
    storeSource.includes("projectRuntimeShellNodesFromFacts"),
    false
  );
});
