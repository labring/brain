import { getDefaultStore } from "jotai";

import {
  appTokenAtom,
  currentWorkspaceAtom,
  kubeconfigAtom,
  namespaceAtom,
  regionalTokenAtom,
  sessionStatusAtom,
  sessionUserAtom,
  workspacesAtom,
} from "@/lib/auth-store";

import {
  type FetchBrainSessionResult,
  fetchBrainSession,
  type SessionFetch,
} from "./session-client";
import type { BrainSession } from "./session-schema";

/**
 * Writes the Brain Session into the atoms and runs the establish flow
 * against a Jotai store. Module functions rather than hooks so the session
 * bootstrap and the 401 re-exchange inside a fetcher share one code path;
 * concurrent establishes against the same store collapse into one request.
 */

export type JotaiStore = ReturnType<typeof getDefaultStore>;

export function applyBrainSession(store: JotaiStore, session: BrainSession) {
  store.set(kubeconfigAtom, session.kubeconfig);
  store.set(namespaceAtom, session.namespace);
  store.set(appTokenAtom, session.appToken);
  store.set(regionalTokenAtom, session.regionalToken);
  store.set(currentWorkspaceAtom, session.workspace);
  store.set(workspacesAtom, session.workspaces);
  store.set(sessionUserAtom, session.user);
  store.set(sessionStatusAtom, { kind: "ready" });
}

/**
 * The credentials stop being sent the moment the session is known stale;
 * the Workspace list and user stay so the shell keeps its shape under the
 * overlay.
 */
export function markSessionExpired(store: JotaiStore) {
  store.set(kubeconfigAtom, "");
  store.set(appTokenAtom, "");
  store.set(regionalTokenAtom, "");
  store.set(sessionStatusAtom, { kind: "expired" });
}

const inFlight = new WeakMap<JotaiStore, Promise<FetchBrainSessionResult>>();

/**
 * Establishes (or re-establishes) the session for `nsid` and applies it. A
 * 401 marks the session expired; any other failure records the error code
 * and leaves the previous credentials untouched, so a transient Desktop
 * outage during a re-exchange does not log the user out.
 */
export function establishSession(
  store: JotaiStore,
  input: { fetchImpl?: SessionFetch; nsid: string | null }
): Promise<FetchBrainSessionResult> {
  const pending = inFlight.get(store);
  if (pending != null) {
    return pending;
  }
  if (store.get(sessionStatusAtom).kind !== "ready") {
    store.set(sessionStatusAtom, { kind: "establishing" });
  }
  const run = fetchBrainSession({ nsid: input.nsid }, input.fetchImpl)
    .then((result) => {
      if (result.kind === "ok") {
        applyBrainSession(store, result.session);
      } else if (result.kind === "unauthorized") {
        markSessionExpired(store);
      } else if (store.get(sessionStatusAtom).kind !== "ready") {
        store.set(sessionStatusAtom, {
          code: result.kind === "network" ? "network" : result.code,
          kind: "error",
        });
      }
      return result;
    })
    .finally(() => {
      if (inFlight.get(store) === run) {
        inFlight.delete(store);
      }
    });
  inFlight.set(store, run);
  return run;
}

/** The store the app tree uses (`JotaiProvider` mounts the default store). */
export function appSessionStore(): JotaiStore {
  return getDefaultStore();
}
