import type { CanvasLayoutResourceRef } from "@/features/project-canvas/layout/types";
import type {
  ApFact,
  DbFact,
  ProjectRuntimeFactKey,
  ProjectRuntimeFacts,
  ProjectRuntimeFactsInput,
  PublicAccessFact,
} from "./resource-facts";
import { projectRuntimeFactsFromResources } from "./resource-facts";
import type { ProjectRuntimeRelationshipIndexes } from "./resource-relationships";

type RuntimeFact = ApFact | DbFact | PublicAccessFact;
type FactSubscriber<TFact extends RuntimeFact> = (
  fact: TFact | undefined
) => void;
type StoreSubscriber = () => void;

export type ProjectRuntimeShellKind = "AP" | "DB" | "PublicAccess";

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
}

interface RuntimeState extends RuntimeMaps {
  relationshipIndexes: ProjectRuntimeRelationshipIndexes;
  resourceTopology: ProjectRuntimeResourceTopologyItem[];
  resourceTopologySignature: string;
}

function factsEqual<TFact extends RuntimeFact>(a: TFact, b: TFact): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function relationshipIndexesEqual(
  a: ProjectRuntimeRelationshipIndexes,
  b: ProjectRuntimeRelationshipIndexes
): boolean {
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

export type ProjectRuntimeResourceTopologyItem =
  | {
      kind: "AP";
      modelKey: ProjectRuntimeFactKey;
      observedUid?: string;
      ref: ApFact["ref"];
    }
  | {
      kind: "DB";
      modelKey: ProjectRuntimeFactKey;
      observedUid?: string;
      ref: DbFact["ref"];
    }
  | {
      kind: "PublicAccess";
      modelKey: ProjectRuntimeFactKey;
      observedUid?: string;
      ref: PublicAccessFact["ref"];
    };

export function projectRuntimeResourceTopologyFromFacts(
  facts: ProjectRuntimeFacts
): ProjectRuntimeResourceTopologyItem[] {
  return [
    ...facts.apFacts.map(
      (fact): ProjectRuntimeResourceTopologyItem => ({
        kind: "AP",
        modelKey: fact.key,
        ...(fact.observedUid === undefined
          ? {}
          : { observedUid: fact.observedUid }),
        ref: fact.ref,
      })
    ),
    ...facts.dbFacts.map(
      (fact): ProjectRuntimeResourceTopologyItem => ({
        kind: "DB",
        modelKey: fact.key,
        ...(fact.observedUid === undefined
          ? {}
          : { observedUid: fact.observedUid }),
        ref: fact.ref,
      })
    ),
    ...facts.publicAccessFacts.map(
      (fact): ProjectRuntimeResourceTopologyItem => ({
        kind: "PublicAccess",
        modelKey: fact.key,
        ...(fact.observedUid === undefined
          ? {}
          : { observedUid: fact.observedUid }),
        ref: fact.ref,
      })
    ),
  ];
}

function projectRuntimeResourceTopologySignature(
  topology: readonly ProjectRuntimeResourceTopologyItem[]
): string {
  return topology
    .map((item) => `${item.kind}:${item.modelKey}:${item.observedUid ?? ""}`)
    .join("|");
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
    resourceTopology: [],
    resourceTopologySignature: "",
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

function notifyStoreSubscribers(subscribers: ReadonlySet<StoreSubscriber>) {
  for (const subscriber of subscribers) {
    subscriber();
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
  selectResourceTopology(): ProjectRuntimeResourceTopologyItem[];
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
  subscribeRelationshipIndexes(subscriber: StoreSubscriber): () => void;
  subscribeResourceTopology(subscriber: StoreSubscriber): () => void;
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
  const relationshipSubscribers = new Set<StoreSubscriber>();
  const resourceTopologySubscribers = new Set<StoreSubscriber>();

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
    };
    const resourceTopology = projectRuntimeResourceTopologyFromFacts(facts);
    const resourceTopologySignature =
      projectRuntimeResourceTopologySignature(resourceTopology);
    const relationshipIndexes = relationshipIndexesEqual(
      state.relationshipIndexes,
      facts.relationshipIndexes
    )
      ? state.relationshipIndexes
      : facts.relationshipIndexes;
    return {
      ...nextMaps,
      relationshipIndexes,
      resourceTopology:
        resourceTopologySignature === state.resourceTopologySignature
          ? state.resourceTopology
          : resourceTopology,
      resourceTopologySignature,
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
      if (previous.relationshipIndexes !== state.relationshipIndexes) {
        notifyStoreSubscribers(relationshipSubscribers);
      }
      if (previous.resourceTopology !== state.resourceTopology) {
        notifyStoreSubscribers(resourceTopologySubscribers);
      }
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
    selectResourceTopology() {
      return state.resourceTopology;
    },
    subscribeRelationshipIndexes(subscriber) {
      relationshipSubscribers.add(subscriber);
      return () => {
        relationshipSubscribers.delete(subscriber);
      };
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
    subscribeResourceTopology(subscriber) {
      resourceTopologySubscribers.add(subscriber);
      return () => {
        resourceTopologySubscribers.delete(subscriber);
      };
    },
  };
}
