import type { Node } from "@xyflow/react";
import {
  canvasPlacementOwnerKey,
  resourcePlacementOwner,
} from "@/features/project-canvas/layout/placement-owner";
import type { CanvasLayoutResourceRef } from "@/features/project-canvas/layout/types";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import type {
  ApFact,
  DbFact,
  ProjectRuntimeFactKey,
  ProjectRuntimeFacts,
  ProjectRuntimeFactsInput,
  PublicAccessFact,
  TemplateNativeWorkloadFact,
} from "./resource-facts";
import { projectRuntimeFactsFromResources } from "./resource-facts";
import type { ProjectRuntimeRelationshipIndexes } from "./resource-relationships";

type RuntimeFact =
  | ApFact
  | DbFact
  | PublicAccessFact
  | TemplateNativeWorkloadFact;
type FactSubscriber<TFact extends RuntimeFact> = (
  fact: TFact | undefined
) => void;

export type ProjectRuntimeShellKind =
  | "AP"
  | "DB"
  | "PublicAccess"
  | "TemplateNativeWorkload";

export interface ProjectRuntimeShellLookup {
  kind: ProjectRuntimeShellKind;
  modelKey: ProjectRuntimeFactKey;
  observedUid?: string;
  placementOwnerKey?: string;
  resourceRef?: CanvasLayoutResourceRef;
}

export interface ProjectRuntimeShellNodeData extends Record<string, unknown> {
  runtime: ProjectRuntimeShellLookup;
}

interface RuntimeMaps {
  apFactsByKey: Map<ProjectRuntimeFactKey, ApFact>;
  dbFactsByKey: Map<ProjectRuntimeFactKey, DbFact>;
  publicAccessFactsByKey: Map<ProjectRuntimeFactKey, PublicAccessFact>;
  templateNativeWorkloadFactsByKey: Map<
    ProjectRuntimeFactKey,
    TemplateNativeWorkloadFact
  >;
}

interface RuntimeState extends RuntimeMaps {
  relationshipIndexes: ProjectRuntimeRelationshipIndexes;
  shellNodes: Node<ProjectRuntimeShellNodeData>[];
  shellSignature: string;
}

const FALLBACK_COLUMNS = 3;
const FALLBACK_COL_GAP = 340;
const FALLBACK_ROW_GAP = 280;

function fallbackCanvasPosition(index: number): { x: number; y: number } {
  return {
    x: (index % FALLBACK_COLUMNS) * FALLBACK_COL_GAP,
    y: Math.floor(index / FALLBACK_COLUMNS) * FALLBACK_ROW_GAP,
  };
}

function stableNodeName(name: string): string {
  return name.replace(/\s+/g, "-");
}

function factsEqual<TFact extends RuntimeFact>(a: TFact, b: TFact): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mapFactsWithStructuralSharing<TFact extends RuntimeFact>(
  current: ReadonlyMap<ProjectRuntimeFactKey, TFact>,
  facts: readonly TFact[]
): Map<ProjectRuntimeFactKey, TFact> {
  const next = new Map<ProjectRuntimeFactKey, TFact>();
  for (const fact of facts) {
    const previous = current.get(fact.key);
    next.set(
      fact.key,
      previous !== undefined && factsEqual(previous, fact) ? previous : fact
    );
  }
  return next;
}

function resourceShellData(
  kind: Exclude<ProjectRuntimeShellKind, "TemplateNativeWorkload">,
  key: ProjectRuntimeFactKey,
  ref: CanvasLayoutResourceRef,
  observedUid: string | undefined
): ProjectRuntimeShellNodeData {
  const owner = resourcePlacementOwner(ref);
  return {
    runtime: {
      kind,
      modelKey: key,
      ...(observedUid === undefined ? {} : { observedUid }),
      placementOwnerKey: canvasPlacementOwnerKey(owner),
      resourceRef: ref,
    },
  };
}

export function projectRuntimeShellNodesFromFacts(
  facts: ProjectRuntimeFacts
): Node<ProjectRuntimeShellNodeData>[] {
  let index = 0;
  const nodes: Node<ProjectRuntimeShellNodeData>[] = [];
  for (const fact of facts.apFacts) {
    nodes.push({
      data: resourceShellData("AP", fact.key, fact.ref, fact.observedUid),
      id: `ap-${stableNodeName(fact.ref.name)}`,
      position: fallbackCanvasPosition(index),
      type: CANVAS_CONTAINER_NODE_TYPE,
    });
    index += 1;
  }
  for (const fact of facts.dbFacts) {
    nodes.push({
      data: resourceShellData("DB", fact.key, fact.ref, fact.observedUid),
      id: `db-${stableNodeName(fact.ref.name)}`,
      position: fallbackCanvasPosition(index),
      type: CANVAS_DATABASE_NODE_TYPE,
    });
    index += 1;
  }
  for (const fact of facts.publicAccessFacts) {
    nodes.push({
      data: resourceShellData(
        "PublicAccess",
        fact.key,
        fact.ref,
        fact.observedUid
      ),
      id: `entry-${stableNodeName(fact.ref.name)}`,
      position: fallbackCanvasPosition(index),
      type: CANVAS_ENTRY_NODE_TYPE,
    });
    index += 1;
  }
  for (const fact of facts.templateNativeWorkloadFacts) {
    nodes.push({
      data: {
        runtime: {
          kind: "TemplateNativeWorkload",
          modelKey: fact.key,
        },
      },
      id: `template-${stableNodeName(fact.ref.name)}`,
      position: fallbackCanvasPosition(index),
      type: CANVAS_CONTAINER_NODE_TYPE,
    });
    index += 1;
  }
  return nodes;
}

export function projectRuntimeShellSignatureFromFacts(
  facts: ProjectRuntimeFacts
): string {
  return [
    ...facts.apFacts.map((fact) => `AP:${fact.key}:${fact.observedUid ?? ""}`),
    ...facts.dbFacts.map((fact) => `DB:${fact.key}:${fact.observedUid ?? ""}`),
    ...facts.publicAccessFacts.map(
      (fact) => `PublicAccess:${fact.key}:${fact.observedUid ?? ""}`
    ),
    ...facts.templateNativeWorkloadFacts.map(
      (fact) => `TemplateNativeWorkload:${fact.key}:${fact.observedUid ?? ""}`
    ),
  ].join("|");
}

function emptyState(): RuntimeState {
  return {
    apFactsByKey: new Map(),
    dbFactsByKey: new Map(),
    publicAccessFactsByKey: new Map(),
    relationshipIndexes: {
      apEnvironmentDbReferenceSources: [],
      apToDb: [],
      publicAccessToAp: [],
    },
    shellNodes: [],
    shellSignature: "",
    templateNativeWorkloadFactsByKey: new Map(),
  };
}

function notifyFactChanges<TFact extends RuntimeFact>(
  before: ReadonlyMap<ProjectRuntimeFactKey, TFact>,
  after: ReadonlyMap<ProjectRuntimeFactKey, TFact>,
  subscribers: ReadonlyMap<ProjectRuntimeFactKey, Set<FactSubscriber<TFact>>>
) {
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const previous = before.get(key);
    const next = after.get(key);
    if (previous === next) {
      continue;
    }
    for (const subscriber of subscribers.get(key) ?? []) {
      subscriber(next);
    }
  }
}

export interface ProjectRuntimeStore {
  commitResources(input: ProjectRuntimeFactsInput): void;
  selectApFact(key: ProjectRuntimeFactKey): ApFact | undefined;
  selectDbFact(key: ProjectRuntimeFactKey): DbFact | undefined;
  selectPublicAccessFact(
    key: ProjectRuntimeFactKey
  ): PublicAccessFact | undefined;
  selectRelationshipIndexes(): ProjectRuntimeRelationshipIndexes;
  selectShellNodes(): Node<ProjectRuntimeShellNodeData>[];
  subscribeApFact(
    key: ProjectRuntimeFactKey,
    subscriber: FactSubscriber<ApFact>
  ): () => void;
  subscribeDbFact(
    key: ProjectRuntimeFactKey,
    subscriber: FactSubscriber<DbFact>
  ): () => void;
  subscribePublicAccessFact(
    key: ProjectRuntimeFactKey,
    subscriber: FactSubscriber<PublicAccessFact>
  ): () => void;
}

export function createProjectRuntimeStore(): ProjectRuntimeStore {
  let state = emptyState();
  const apSubscribers = new Map<
    ProjectRuntimeFactKey,
    Set<FactSubscriber<ApFact>>
  >();
  const dbSubscribers = new Map<
    ProjectRuntimeFactKey,
    Set<FactSubscriber<DbFact>>
  >();
  const publicAccessSubscribers = new Map<
    ProjectRuntimeFactKey,
    Set<FactSubscriber<PublicAccessFact>>
  >();

  function updateState(facts: ProjectRuntimeFacts): RuntimeState {
    const nextMaps: RuntimeMaps = {
      apFactsByKey: mapFactsWithStructuralSharing(
        state.apFactsByKey,
        facts.apFacts
      ),
      dbFactsByKey: mapFactsWithStructuralSharing(
        state.dbFactsByKey,
        facts.dbFacts
      ),
      publicAccessFactsByKey: mapFactsWithStructuralSharing(
        state.publicAccessFactsByKey,
        facts.publicAccessFacts
      ),
      templateNativeWorkloadFactsByKey: mapFactsWithStructuralSharing(
        state.templateNativeWorkloadFactsByKey,
        facts.templateNativeWorkloadFacts
      ),
    };
    const shellSignature = projectRuntimeShellSignatureFromFacts(facts);
    return {
      ...nextMaps,
      relationshipIndexes: facts.relationshipIndexes,
      shellNodes:
        shellSignature === state.shellSignature
          ? state.shellNodes
          : projectRuntimeShellNodesFromFacts(facts),
      shellSignature,
    };
  }

  return {
    commitResources(input) {
      const previous = state;
      state = updateState(projectRuntimeFactsFromResources(input));
      notifyFactChanges(
        previous.apFactsByKey,
        state.apFactsByKey,
        apSubscribers
      );
      notifyFactChanges(
        previous.dbFactsByKey,
        state.dbFactsByKey,
        dbSubscribers
      );
      notifyFactChanges(
        previous.publicAccessFactsByKey,
        state.publicAccessFactsByKey,
        publicAccessSubscribers
      );
    },
    selectApFact(key) {
      return state.apFactsByKey.get(key);
    },
    selectDbFact(key) {
      return state.dbFactsByKey.get(key);
    },
    selectPublicAccessFact(key) {
      return state.publicAccessFactsByKey.get(key);
    },
    selectRelationshipIndexes() {
      return state.relationshipIndexes;
    },
    selectShellNodes() {
      return state.shellNodes;
    },
    subscribeApFact(key, subscriber) {
      let subscribers = apSubscribers.get(key);
      if (subscribers === undefined) {
        subscribers = new Set();
        apSubscribers.set(key, subscribers);
      }
      subscribers.add(subscriber);
      return () => {
        subscribers?.delete(subscriber);
      };
    },
    subscribeDbFact(key, subscriber) {
      let subscribers = dbSubscribers.get(key);
      if (subscribers === undefined) {
        subscribers = new Set();
        dbSubscribers.set(key, subscribers);
      }
      subscribers.add(subscriber);
      return () => {
        subscribers?.delete(subscriber);
      };
    },
    subscribePublicAccessFact(key, subscriber) {
      let subscribers = publicAccessSubscribers.get(key);
      if (subscribers === undefined) {
        subscribers = new Set();
        publicAccessSubscribers.set(key, subscribers);
      }
      subscribers.add(subscriber);
      return () => {
        subscribers?.delete(subscriber);
      };
    },
  };
}
