import "server-only";

import { API_ROUTES } from "@workspace/api/constants";

import {
  UNKNOWN_WORKSPACE_OWNER_STANDING,
  type WorkspaceOwnerStanding,
  workspaceOwnerStandingFromNamespace,
} from "@/features/billing/workspace-owner";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";

/**
 * Reads the workspace's Namespace object with the request kubeconfig
 * through the Go API's generic get (ADR-0082) and judges the Workspace
 * Owner standing from its platform marks. Every failure path — no API
 * configured, a denied read (a role whose kubeconfig cannot get its own
 * namespace lands here, not in an error), a timeout — resolves to unknown,
 * which keeps the balance path closed: never assume the caller is the
 * Owner.
 */

export interface ReadWorkspaceOwnerStandingInput {
  /** The verified app-token `userCrName`; null leaves ownership unknown. */
  crName: string | null;
  encodedKubeconfig: string;
  namespace: string;
  signal?: AbortSignal;
}

export type NamespaceFetch = (
  input: URL,
  init: RequestInit
) => Promise<Response>;

function apiBaseUrl(): string | null {
  const base = process.env.API_URL?.trim() ?? "";
  return base === "" ? null : base;
}

export async function readWorkspaceOwnerStanding(
  input: ReadWorkspaceOwnerStandingInput,
  fetchNamespace: NamespaceFetch = (url, init) => fetch(url, init)
): Promise<WorkspaceOwnerStanding> {
  const base = apiBaseUrl();
  const namespace = input.namespace.trim();
  if (
    base == null ||
    namespace === "" ||
    input.encodedKubeconfig.trim() === ""
  ) {
    return UNKNOWN_WORKSPACE_OWNER_STANDING;
  }
  try {
    const url = new URL(API_ROUTES.k8s.get, base);
    url.searchParams.set("kind", "namespaces");
    url.searchParams.set("name", namespace);
    const response = await fetchNamespace(url, {
      headers: {
        Accept: "application/json",
        Authorization: kubeconfigBearerHeader(input.encodedKubeconfig),
      },
      method: "GET",
      signal: input.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return UNKNOWN_WORKSPACE_OWNER_STANDING;
    }
    return workspaceOwnerStandingFromNamespace(
      await response.json(),
      input.crName
    );
  } catch {
    return UNKNOWN_WORKSPACE_OWNER_STANDING;
  }
}
