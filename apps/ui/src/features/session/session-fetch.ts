import { currentWorkspaceAtom, regionalTokenAtom } from "@/lib/auth-store";
import { regionTokenRequestHeaders } from "@/lib/region-token-header";

import type { SessionFetch } from "./session-client";
import {
  appSessionStore,
  establishSession,
  type JotaiStore,
  markSessionExpired,
} from "./session-store";

/**
 * The fetch every Workspace-management fetcher goes through (spec §A.7,
 * §A.8): it attaches `X-Sealos-Region-Token` from the session and runs the
 * 401 two-step — on a 401, silently re-establish the session for the current
 * Workspace (the atoms update in place, so every credential-keyed cache
 * invalidates), retry the request once with the new token, and on a second
 * 401 mark the session expired so the overlay takes over. No lifetime
 * pre-check, no renewal, no cookie rewrite: the user re-logs in on Desktop.
 */
export type BrainFetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export function createSessionFetch(options: {
  fetchImpl?: BrainFetch;
  sessionFetchImpl?: SessionFetch;
  store: JotaiStore;
}): BrainFetch {
  const fetchImpl: BrainFetch =
    options.fetchImpl ?? ((url, init) => fetch(url, init));

  const send = (input: string, init: RequestInit | undefined) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(
      regionTokenRequestHeaders(options.store.get(regionalTokenAtom))
    )) {
      headers.set(name, value);
    }
    return fetchImpl(input, { ...init, headers });
  };

  return async (input, init) => {
    const first = await send(input, init);
    if (first.status !== 401) {
      return first;
    }
    const nsid = options.store.get(currentWorkspaceAtom)?.id ?? null;
    const reestablished = await establishSession(options.store, {
      fetchImpl: options.sessionFetchImpl,
      nsid,
    });
    if (reestablished.kind !== "ok") {
      // `unauthorized` already marked the session expired; any other
      // failure leaves the old credentials and hands the 401 back.
      return first;
    }
    await first.body?.cancel();
    const second = await send(input, init);
    if (second.status === 401) {
      markSessionExpired(options.store);
    }
    return second;
  };
}

/** The app's Workspace-management fetch, bound to the app store. */
export const sessionFetch: BrainFetch = (input, init) =>
  createSessionFetch({ store: appSessionStore() })(input, init);
