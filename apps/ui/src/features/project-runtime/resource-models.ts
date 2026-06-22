import type { DatabaseNodeConnection } from "@workspace/ui/components/database-node/database-node";

import { publicAccessSelectionKey } from "@/features/project-canvas/nodes/entry-node-selection";
import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
  CanvasEntryNodeData,
} from "@/features/project-canvas/nodes/types";
import type {
  ApFact,
  DbFact,
  ProjectRuntimeFactKey,
  ProjectRuntimeFacts,
  PublicAccessFact,
  TemplateNativeWorkloadFact,
} from "./resource-facts";
import type {
  ProjectRuntimeShellKind,
  ProjectRuntimeShellLookup,
  ProjectRuntimeShellNodeData,
} from "./resource-store";

export interface ProjectRuntimeNodeModels {
  containerModelsByKey: ReadonlyMap<
    ProjectRuntimeFactKey,
    CanvasContainerNodeData
  >;
  databaseModelsByKey: ReadonlyMap<
    ProjectRuntimeFactKey,
    CanvasDatabaseNodeData
  >;
  entryModelsByKey: ReadonlyMap<ProjectRuntimeFactKey, CanvasEntryNodeData>;
}

export type ProjectRuntimeNodeModel =
  | CanvasContainerNodeData
  | CanvasDatabaseNodeData
  | CanvasEntryNodeData;

function apModelFromFact(fact: ApFact): CanvasContainerNodeData {
  return {
    resourceKind: "ap",
    states: {
      image: fact.workload.image,
      kind: fact.workload.kind,
      name: fact.displayName,
      namespace: fact.ref.namespace,
      ...(fact.replicaSummary === undefined
        ? {}
        : { replicas: fact.replicaSummary.replicas }),
      status: fact.status,
      ...(fact.observedUid === undefined ? {} : { uid: fact.observedUid }),
    },
  };
}

function templateNativeModelFromFact(
  fact: TemplateNativeWorkloadFact
): CanvasContainerNodeData {
  return {
    resourceKind: "template",
    states: {
      image: fact.workload.image,
      kind: fact.workload.kind,
      name: fact.displayName,
      namespace: fact.ref.namespace,
      ...(fact.replicaSummary === undefined
        ? {}
        : { replicas: fact.replicaSummary.replicas }),
      status: fact.status,
      ...(fact.observedUid === undefined ? {} : { uid: fact.observedUid }),
    },
  };
}

function dbConnectionsFromFact(fact: DbFact): DatabaseNodeConnection[] {
  return [
    {
      id: "private",
      kind: "private",
      label: "Private connection",
      ...(fact.connectionSummary.private.value === undefined
        ? {}
        : { value: fact.connectionSummary.private.value }),
    },
    {
      id: "public",
      kind: "public",
      label: "Public connection",
      publicAccess: { enabled: fact.connectionSummary.public.enabled },
      ...(fact.connectionSummary.public.value === undefined
        ? {}
        : { value: fact.connectionSummary.public.value }),
    },
  ];
}

function dbModelFromFact(fact: DbFact): CanvasDatabaseNodeData {
  return {
    connections: dbConnectionsFromFact(fact),
    ...(fact.metadataLabels === undefined
      ? {}
      : { metadata: { labels: fact.metadataLabels } }),
    states: {
      displayEngine: fact.engine.displayName,
      ...(fact.engine.key === undefined ? {} : { engineKey: fact.engine.key }),
      ...(fact.version === undefined ? {} : { formattedVersion: fact.version }),
      ...(fact.capacitySummary === undefined
        ? {}
        : {
            metricCapacities: {
              ...(fact.capacitySummary.cpu === undefined
                ? {}
                : { cpu: fact.capacitySummary.cpu }),
              ...(fact.capacitySummary.memory === undefined
                ? {}
                : { memory: fact.capacitySummary.memory }),
              ...(fact.capacitySummary.storage === undefined
                ? {}
                : { storage: fact.capacitySummary.storage }),
            },
          }),
      metrics: {},
      name: fact.displayName,
      status: fact.status,
      ...(fact.observedUid === undefined ? {} : { uid: fact.observedUid }),
    },
    ...(fact.observedUid === undefined ? {} : { uid: fact.observedUid }),
    workload: { name: fact.ref.name, namespace: fact.ref.namespace },
  };
}

function publicAccessModelFromFact(
  fact: PublicAccessFact
): CanvasEntryNodeData {
  return {
    ...(fact.accessDomain === undefined
      ? {}
      : { accessDomain: fact.accessDomain }),
    resource: {
      apRef: fact.apRef.name,
      name: fact.displayName,
      namespace: fact.ref.namespace,
      selectionKey: publicAccessSelectionKey({
        apName: fact.apRef.name,
        namespace: fact.ref.namespace,
      }),
      ...(fact.observedUid === undefined ? {} : { uid: fact.observedUid }),
    },
    states: { name: fact.displayName },
    targets: fact.targets.map((target) => ({
      id: target.id,
      label: target.label,
      status: target.status,
      value: target.value,
    })),
  };
}

export function projectRuntimeNodeModelsFromFacts(
  facts: ProjectRuntimeFacts
): ProjectRuntimeNodeModels {
  const containerModelsByKey = new Map<
    ProjectRuntimeFactKey,
    CanvasContainerNodeData
  >();
  const databaseModelsByKey = new Map<
    ProjectRuntimeFactKey,
    CanvasDatabaseNodeData
  >();
  const entryModelsByKey = new Map<
    ProjectRuntimeFactKey,
    CanvasEntryNodeData
  >();

  for (const fact of facts.apFacts) {
    containerModelsByKey.set(fact.key, apModelFromFact(fact));
  }
  for (const fact of facts.templateNativeWorkloadFacts) {
    containerModelsByKey.set(fact.key, templateNativeModelFromFact(fact));
  }
  for (const fact of facts.dbFacts) {
    databaseModelsByKey.set(fact.key, dbModelFromFact(fact));
  }
  for (const fact of facts.publicAccessFacts) {
    entryModelsByKey.set(fact.key, publicAccessModelFromFact(fact));
  }

  return { containerModelsByKey, databaseModelsByKey, entryModelsByKey };
}

export function projectRuntimeShellLookupFromNodeData(
  data: unknown
): ProjectRuntimeShellLookup | undefined {
  const runtime =
    data != null && typeof data === "object"
      ? (data as Partial<ProjectRuntimeShellNodeData>).runtime
      : undefined;
  if (runtime == null || typeof runtime !== "object") {
    return undefined;
  }
  if (!isProjectRuntimeShellKind(runtime.kind)) {
    return undefined;
  }
  if (typeof runtime.modelKey !== "string" || runtime.modelKey.trim() === "") {
    return undefined;
  }
  return runtime;
}

function isProjectRuntimeShellKind(
  value: unknown
): value is ProjectRuntimeShellKind {
  return (
    value === "AP" ||
    value === "DB" ||
    value === "PublicAccess" ||
    value === "TemplateNativeWorkload"
  );
}

export function selectProjectRuntimeNodeModel(
  models: ProjectRuntimeNodeModels,
  lookup: ProjectRuntimeShellLookup | undefined
): ProjectRuntimeNodeModel | undefined {
  if (lookup === undefined) {
    return undefined;
  }
  switch (lookup.kind) {
    case "AP":
    case "TemplateNativeWorkload":
      return models.containerModelsByKey.get(lookup.modelKey);
    case "DB":
      return models.databaseModelsByKey.get(lookup.modelKey);
    case "PublicAccess":
      return models.entryModelsByKey.get(lookup.modelKey);
    default:
      return undefined;
  }
}
