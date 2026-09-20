import "server-only";

import { normalizeAssistantNamespace } from "@/features/chat/persistence/types";
import {
  authorizeKubeconfigNamespace,
  type VerifyKubeconfigNamespace,
} from "@/lib/request-kubeconfig-auth";

export type ResolveChatNamespaceOutcome =
  | { ok: true; namespace: string }
  | { ok: false; status: number; message: string };

/**
 * Authoritative namespace for chat ACL and future per-ns quota.
 *
 * Authenticity (always):
 * - Valid client kubeconfig YAML
 * - Client `namespace` consistent with kubeconfig `current-context` when set
 * - The kubeconfig's live access to that namespace (`verify`)
 *
 * The client kubeconfig comes from the Brain Session (ADR-0083) — the one
 * Desktop issued for the current Workspace — and the namespace comes from
 * its context; there is no development branch here.
 */
export async function resolveAuthoritativeChatNamespace(options: {
  encodedKubeconfig: string | undefined;
  clientNamespace: string;
  verify?: VerifyKubeconfigNamespace;
}): Promise<ResolveChatNamespaceOutcome> {
  const clientNamespace = options.clientNamespace.trim();
  const authorization = await authorizeKubeconfigNamespace({
    encodedKubeconfig: options.encodedKubeconfig,
    expectedNamespace:
      clientNamespace === "" ? undefined : options.clientNamespace,
    normalizeNamespace: normalizeAssistantNamespace,
    verify: options.verify,
  });
  if (!authorization.ok) {
    if (authorization.code === "verification_failed") {
      return {
        message: authorization.message,
        ok: false,
        status: authorization.status,
      };
    }
    if (
      authorization.code === "authentication_required" ||
      authorization.code === "invalid_kubeconfig"
    ) {
      return {
        message: "Missing or invalid kubeconfig",
        ok: false,
        status: 400,
      };
    }
    if (authorization.code === "namespace_unresolved") {
      return {
        message:
          "Could not resolve namespace from kubeconfig (missing or invalid current-context).",
        ok: false,
        status: 400,
      };
    }
    return {
      message: "namespace does not match kubeconfig current context.",
      ok: false,
      status: 403,
    };
  }

  return { ok: true, namespace: authorization.namespace };
}
