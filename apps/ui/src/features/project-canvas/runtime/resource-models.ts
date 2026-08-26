import { databaseDeviconSrc } from "@workspace/ui/assets/devicons";
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
      // `name` stays the workload identity every panel and telemetry target
      // reads; the Resource Display Name rides alongside for display only.
      displayName: fact.displayName,
      image: fact.workload.image,
      kind: fact.workload.kind,
      name: fact.ref.name,
      namespace: fact.ref.namespace,
      ...(fact.replicaSummary?.desired === undefined
        ? {}
        : { replicas: fact.replicaSummary.desired }),
      ...(fact.replicaSummary?.ready === undefined
        ? {}
        : { readyReplicas: fact.replicaSummary.ready }),
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
  const iconUrl = databaseDeviconSrc(fact.engine.key);

  return {
    connections: dbConnectionsFromFact(fact),
    ...(fact.metadataLabels === undefined
      ? {}
      : { metadata: { labels: fact.metadataLabels } }),
    states: {
      ...(fact.deletionTimestamp === undefined
        ? {}
        : { deletionTimestamp: fact.deletionTimestamp }),
      displayEngine: fact.engine.displayName,
      displayName: fact.displayName,
      ...(fact.engine.key === undefined ? {} : { engineKey: fact.engine.key }),
      ...(fact.version === undefined ? {} : { formattedVersion: fact.version }),
      ...(iconUrl === undefined ? {} : { iconUrl }),
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
      name: fact.ref.name,
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
      name: fact.apRef.name,
      namespace: fact.ref.namespace,
      selectionKey: publicAccessSelectionKey({
        apName: fact.apRef.name,
        namespace: fact.ref.namespace,
      }),
      ...(fact.observedUid === undefined ? {} : { uid: fact.observedUid }),
    },
    states: { displayName: fact.displayName, name: fact.apRef.name },
    targets: fact.targets.map((target) => ({
      id: target.id,
      label: target.label,
      status: target.status,
      value: target.value,
    })),
  };
}

export function projectRuntimeNodeModelFromFact(
  kind: ProjectRuntimeShellKind,
  fact: ApFact | DbFact | PublicAccessFact
): ProjectRuntimeNodeModel | undefined {
  switch (kind) {
    case "AP":
      return apModelFromFact(fact as ApFact);
    case "DB":
      return dbModelFromFact(fact as DbFact);
    case "PublicAccess":
      return publicAccessModelFromFact(fact as PublicAccessFact);
    default:
      return undefined;
  }
}

function fallbackApModelFromLookup(
  lookup: ProjectRuntimeShellLookup
): CanvasContainerNodeData {
  const ref = lookup.resourceRef;
  return {
    resourceKind: "ap",
    states: {
      image: "—",
      kind: "AP",
      name: ref?.name ?? lookup.modelKey,
      ...(ref?.namespace === undefined ? {} : { namespace: ref.namespace }),
      status: { label: "Loading", tone: "pending" },
      ...(lookup.observedUid === undefined ? {} : { uid: lookup.observedUid }),
    },
  };
}

function fallbackDatabaseModelFromLookup(
  lookup: ProjectRuntimeShellLookup
): CanvasDatabaseNodeData {
  const ref = lookup.resourceRef;
  return {
    connections: [],
    states: {
      displayEngine: "Database",
      name: ref?.name ?? lookup.modelKey,
      status: { label: "Loading", tone: "pending" },
      ...(lookup.observedUid === undefined ? {} : { uid: lookup.observedUid }),
    },
    workload: {
      name: ref?.name ?? lookup.modelKey,
      namespace: ref?.namespace ?? "",
    },
  };
}

function fallbackPublicAccessModelFromLookup(
  lookup: ProjectRuntimeShellLookup
): CanvasEntryNodeData {
  const ref = lookup.resourceRef;
  return {
    resource: {
      apRef: ref?.name,
      name: ref?.name ?? lookup.modelKey,
      namespace: ref?.namespace ?? "",
    },
    states: { name: ref?.name ?? lookup.modelKey },
    targets: [],
  };
}

export function projectRuntimeFallbackNodeModelFromLookup(
  lookup: ProjectRuntimeShellLookup | undefined
): ProjectRuntimeNodeModel | undefined {
  if (lookup === undefined) {
    return undefined;
  }
  switch (lookup.kind) {
    case "AP":
      return fallbackApModelFromLookup(lookup);
    case "DB":
      return fallbackDatabaseModelFromLookup(lookup);
    case "PublicAccess":
      return fallbackPublicAccessModelFromLookup(lookup);
    default:
      return undefined;
  }
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
  return value === "AP" || value === "DB" || value === "PublicAccess";
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
      return models.containerModelsByKey.get(lookup.modelKey);
    case "DB":
      return models.databaseModelsByKey.get(lookup.modelKey);
    case "PublicAccess":
      return models.entryModelsByKey.get(lookup.modelKey);
    default:
      return undefined;
  }
}
