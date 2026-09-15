import "server-only";

import { rewriteKubeconfigContextNamespace } from "@/lib/kubeconfig-namespace-core";

import type {
  BrainSession,
  SessionUser,
  SessionWorkspace,
} from "../session-schema";
import type { AuthInfoData, DesktopAuthApi } from "./desktop-auth-api";
import type { DesktopCallFailure } from "./desktop-client";
import { type RegionalTokenClaims, regionalTokenClaims } from "./jwt-payload";

/**
 * Establishes the Brain Session (ADR-0083, spec §A.1) from a global token:
 * `regionToken` (always lands in the Personal Workspace) → `namespace/list`
 * → `namespace/switch` when the requested `nsid` names a Team Workspace the
 * user belongs to, in parallel with `auth/info` → the kubeconfig's context
 * namespace rewritten locally to the target Workspace. A `nsid` outside the
 * list lands in the Personal Workspace with `fallback: "not_member"`, as
 * Desktop's own home page does. A `409 workspace is not inited` is an
 * anomaly, never repaired: establishing a session must not create a
 * Workspace as a side effect, so `autoInitRegionToken` is never called.
 */

export type SessionStep = "info" | "list" | "regionToken" | "switch";

export type SessionFailure =
  /** The global token was rejected — the shared login cookie is stale. */
  | { kind: "unauthorized"; step: SessionStep }
  /** Desktop's `409 workspace is not inited` on `regionToken`. */
  | { kind: "not_inited" }
  /** Any other Desktop business code or HTTP status. */
  | { code: number; kind: "desktop_error"; step: SessionStep }
  /** A response, token, or kubeconfig Brain could not make sense of. */
  | { kind: "malformed"; step: SessionStep }
  | { kind: "timeout"; step: SessionStep }
  | { kind: "unreachable"; step: SessionStep };

export type EstablishSessionOutcome =
  | { ok: true; session: BrainSession }
  | { failure: SessionFailure; ok: false };

export interface EstablishSessionInput {
  globalToken: string;
  /** Desktop's current namespace id from the SDK; null lands in Personal. */
  nsid: string | null;
}

function failed(failure: SessionFailure): EstablishSessionOutcome {
  return { failure, ok: false };
}

function failureOf(
  step: SessionStep,
  failure: DesktopCallFailure
): SessionFailure {
  switch (failure.kind) {
    case "desktop_code":
      if (failure.code === 401) {
        return { kind: "unauthorized", step };
      }
      if (step === "regionToken" && failure.code === 409) {
        return { kind: "not_inited" };
      }
      return { code: failure.code, kind: "desktop_error", step };
    case "http":
      return { code: failure.status, kind: "desktop_error", step };
    case "malformed":
      return { kind: "malformed", step };
    case "timeout":
      return { kind: "timeout", step };
    default:
      return { kind: "unreachable", step };
  }
}

/**
 * Where the session lands (spec §A.1): the requested `nsid` when it is in
 * the list, else the Personal Workspace — flagged as a fallback when a
 * `nsid` was asked for and not found.
 */
export function resolveTargetWorkspace(input: {
  nsid: string | null;
  personal: SessionWorkspace;
  workspaces: SessionWorkspace[];
}): { fallback: "not_member" | undefined; target: SessionWorkspace } {
  const requestedNsid = input.nsid?.trim() ?? "";
  if (requestedNsid === "") {
    return { fallback: undefined, target: input.personal };
  }
  const requested = input.workspaces.find(
    (workspace) => workspace.id === requestedNsid
  );
  return requested == null
    ? { fallback: "not_member", target: input.personal }
    : { fallback: undefined, target: requested };
}

function personalWorkspace(
  workspaces: SessionWorkspace[],
  claimedUid: string
): SessionWorkspace | null {
  return (
    workspaces.find((workspace) => workspace.uid === claimedUid) ??
    workspaces.find((workspace) => workspace.isPersonal) ??
    null
  );
}

/** Identity from the token Desktop just returned, display data from `info`. */
function sessionUser(
  claims: RegionalTokenClaims,
  info: AuthInfoData["info"]
): SessionUser {
  return {
    avatar: info.avatarUri?.trim() ?? "",
    crName: claims.userCrName,
    name: info.nickname?.trim() || info.name?.trim() || "",
    userId: claims.userId || (info.id?.trim() ?? ""),
    userUid: claims.userUid || (info.uid?.trim() ?? ""),
  };
}

export async function establishBrainSession(
  input: EstablishSessionInput,
  desktop: DesktopAuthApi
): Promise<EstablishSessionOutcome> {
  const minted = await desktop.regionToken(input.globalToken);
  if (!minted.ok) {
    return failed(failureOf("regionToken", minted));
  }
  const personalClaims = regionalTokenClaims(minted.data.token);
  if (personalClaims == null) {
    return failed({ kind: "malformed", step: "regionToken" });
  }

  const listed = await desktop.namespaceList(minted.data.token);
  if (!listed.ok) {
    return failed(failureOf("list", listed));
  }
  const workspaces = listed.data;
  const personal = personalWorkspace(workspaces, personalClaims.workspaceUid);
  if (personal == null) {
    return failed({ kind: "malformed", step: "list" });
  }
  const { fallback, target } = resolveTargetWorkspace({
    nsid: input.nsid,
    personal,
    workspaces,
  });

  const [switched, info] = await Promise.all([
    target.uid === personal.uid
      ? Promise.resolve(null)
      : desktop.namespaceSwitch(minted.data.token, target.uid),
    desktop.authInfo(minted.data.token),
  ]);
  if (switched != null && !switched.ok) {
    return failed(failureOf("switch", switched));
  }
  if (!info.ok) {
    return failed(failureOf("info", info));
  }

  const tokens = switched?.ok ? switched.data : minted.data;
  const claims = switched?.ok
    ? regionalTokenClaims(tokens.token)
    : personalClaims;
  if (claims == null) {
    return failed({ kind: "malformed", step: "switch" });
  }

  // Desktop's regionToken kubeconfig is not namespace-patched, so even the
  // Personal Workspace gets the rewrite.
  const kubeconfig = rewriteKubeconfigContextNamespace(
    minted.data.kubeconfig,
    target.id
  );
  if (kubeconfig == null) {
    return failed({ kind: "malformed", step: "regionToken" });
  }

  return {
    ok: true,
    session: {
      appToken: tokens.appToken,
      ...(fallback == null ? {} : { fallback }),
      kubeconfig,
      namespace: target.id,
      regionalToken: tokens.token,
      user: sessionUser(claims, info.data.info),
      workspace: target,
      workspaces,
    },
  };
}
