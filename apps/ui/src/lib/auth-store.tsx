import { atom } from "jotai";

import type {
  SessionUser,
  SessionWorkspace,
} from "@/features/session/session-schema";

/**
 * The Brain Session (ADR-0083, CONTEXT.md): the Desktop-issued credentials
 * Brain holds in one browser tab, exchanged from Desktop's shared login
 * cookie by `POST /api/session` and kept only here, in page memory. Brain
 * writes no cookie and no storage of its own; a reload re-establishes the
 * session, and the Workspace it points at is Desktop's current one, which
 * Brain follows rather than remembers.
 *
 * Every client cache key must derive from these atoms (spec §A.9): see
 * `features/session/swr-keys.ts`. The three credentials and their headers:
 * kubeconfig → `Authorization: Bearer`, app token → `X-Sealos-App-Token`
 * (ADR-0059), regional token → `X-Sealos-Region-Token`.
 */

export const kubeconfigAtom = atom("");

export const namespaceAtom = atom("");

/** Desktop-minted App Token for personal-resource requests (ADR-0059). */
export const appTokenAtom = atom("");

/** Desktop regional token for Workspace-management requests (ADR-0083). */
export const regionalTokenAtom = atom("");

/** The Workspace the session is established in — Desktop's current one. */
export const currentWorkspaceAtom = atom<SessionWorkspace | null>(null);

/** Every Workspace the user belongs to in this region, Personal first. */
export const workspacesAtom = atom<SessionWorkspace[]>([]);

/** The signed-in user's display data, from Desktop's `auth/info`. */
export const sessionUserAtom = atom<SessionUser | null>(null);

export type SessionStatus =
  | { kind: "idle" }
  | { kind: "establishing" }
  | { kind: "ready" }
  /** The login cookie is stale: the "session expired" overlay is up. */
  | { kind: "expired" }
  | { kind: "error"; code: string };

export const sessionStatusAtom = atom<SessionStatus>({ kind: "idle" });

/** Read-only projections the App Sidebar's account section renders. */
export const desktopUserIdAtom = atom(
  (get) => get(sessionUserAtom)?.userId ?? ""
);

export const desktopUserNameAtom = atom(
  (get) => get(sessionUserAtom)?.name ?? ""
);

export const desktopUserAvatarAtom = atom(
  (get) => get(sessionUserAtom)?.avatar ?? ""
);

export const desktopLanguageAtom = atom("en");

/** Desktop's cloud domain from the SDK host config; "" outside the iframe. */
export const desktopDomainAtom = atom("");
