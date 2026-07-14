import type { ProjectResourceActions } from "@/features/project-canvas/actions/resource-actions";

type DbLifecycleOperations = ProjectResourceActions["dbLifecycle"];
type DbLifecycleWorkloadRefInput = Parameters<
  DbLifecycleOperations["isLoading"]
>[0];
type DbPublicAccessPendingTarget = ReturnType<
  DbLifecycleOperations["getPublicAccessPendingTarget"]
>;

export interface CanvasApLifecycleActivity {
  authReady: boolean;
}

export interface CanvasDbLifecycleActivity {
  authReady: boolean;
  loadingDelete: boolean;
  loadingRestart: boolean;
  loadingStart: boolean;
  loadingStop: boolean;
  publicAccessPendingTarget: DbPublicAccessPendingTarget;
}

export interface CanvasLifecycleActivityInput {
  apAuthReady: boolean;
  dbAuthReady: boolean;
  getDbPublicAccessPendingTarget: DbLifecycleOperations["getPublicAccessPendingTarget"];
  isDbLifecycleLoading: DbLifecycleOperations["isLoading"];
}

export interface CanvasLifecycleActivityStore {
  getApActivity(): CanvasApLifecycleActivity;
  getDbActivity(ref: DbLifecycleWorkloadRefInput): CanvasDbLifecycleActivity;
  publish(input: CanvasLifecycleActivityInput): void;
  subscribeAp(listener: () => void): () => void;
  subscribeDb(
    ref: DbLifecycleWorkloadRefInput,
    listener: () => void
  ): () => void;
}

const INACTIVE_AP_ACTIVITY: CanvasApLifecycleActivity = { authReady: false };
const INACTIVE_DB_ACTIVITY: CanvasDbLifecycleActivity = {
  authReady: false,
  loadingDelete: false,
  loadingRestart: false,
  loadingStart: false,
  loadingStop: false,
  publicAccessPendingTarget: undefined,
};

function dbActivityKey(ref: DbLifecycleWorkloadRefInput): string {
  return `${ref.namespace}/${ref.name}`;
}

function dbActivitiesEqual(
  a: CanvasDbLifecycleActivity,
  b: CanvasDbLifecycleActivity
): boolean {
  return (
    a.authReady === b.authReady &&
    a.loadingDelete === b.loadingDelete &&
    a.loadingRestart === b.loadingRestart &&
    a.loadingStart === b.loadingStart &&
    a.loadingStop === b.loadingStop &&
    a.publicAccessPendingTarget === b.publicAccessPendingTarget
  );
}

/**
 * Per-node subscription mirror of resource lifecycle activity (auth
 * readiness, in-flight lifecycle actions, optimistic public-access targets).
 * The canvas controller publishes after each commit; node views subscribe to
 * their own workload only, so lifecycle activity changes re-render only the
 * affected node.
 */
export function createCanvasLifecycleActivityStore(): CanvasLifecycleActivityStore {
  let input: CanvasLifecycleActivityInput | null = null;
  let apActivity = INACTIVE_AP_ACTIVITY;
  const apSubscribers = new Set<() => void>();
  const dbSubscribersByKey = new Map<
    string,
    { listeners: Set<() => void>; ref: DbLifecycleWorkloadRefInput }
  >();
  const dbActivityByKey = new Map<string, CanvasDbLifecycleActivity>();

  const computeDbActivity = (
    ref: DbLifecycleWorkloadRefInput
  ): CanvasDbLifecycleActivity => {
    if (input === null) {
      return INACTIVE_DB_ACTIVITY;
    }
    return {
      authReady: input.dbAuthReady,
      loadingDelete: input.isDbLifecycleLoading(ref, "delete"),
      loadingRestart: input.isDbLifecycleLoading(ref, "restart"),
      loadingStart: input.isDbLifecycleLoading(ref, "start"),
      loadingStop: input.isDbLifecycleLoading(ref, "stop"),
      publicAccessPendingTarget: input.getDbPublicAccessPendingTarget(ref),
    };
  };

  return {
    getApActivity() {
      return apActivity;
    },
    getDbActivity(ref) {
      const key = dbActivityKey(ref);
      const cached = dbActivityByKey.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const activity = computeDbActivity(ref);
      dbActivityByKey.set(key, activity);
      return activity;
    },
    publish(nextInput) {
      input = nextInput;

      if (apActivity.authReady !== nextInput.apAuthReady) {
        apActivity = { authReady: nextInput.apAuthReady };
        for (const listener of apSubscribers) {
          listener();
        }
      }

      for (const [key, entry] of dbSubscribersByKey) {
        const previous = dbActivityByKey.get(key);
        const next = computeDbActivity(entry.ref);
        if (previous !== undefined && dbActivitiesEqual(previous, next)) {
          continue;
        }
        dbActivityByKey.set(key, next);
        for (const listener of entry.listeners) {
          listener();
        }
      }
    },
    subscribeAp(listener) {
      apSubscribers.add(listener);
      return () => {
        apSubscribers.delete(listener);
      };
    },
    subscribeDb(ref, listener) {
      const key = dbActivityKey(ref);
      const entry = dbSubscribersByKey.get(key) ?? {
        listeners: new Set<() => void>(),
        ref,
      };
      entry.listeners.add(listener);
      dbSubscribersByKey.set(key, entry);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) {
          dbSubscribersByKey.delete(key);
          dbActivityByKey.delete(key);
        }
      };
    },
  };
}
