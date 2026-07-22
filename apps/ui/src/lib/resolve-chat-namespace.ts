import "server-only";

import { normalizeAssistantNamespace } from "@/features/chat/persistence/types";
import {
  authorizeKubeconfigNamespace,
  type VerifyKubeconfigNamespace,
} from "@/lib/request-kubeconfig-auth";
import {
  devCredentialsFromEnv,
  hasDevCredentialBypass,
} from "@/lib/server-credentials";

import { kubeconfigCredentialsMatch } from "./kubeconfig-identity";

export type ResolveChatNamespaceOutcome =
  | { ok: true; namespace: string }
  | { ok: false; status: number; message: string };

function rejectClientNamespaceMismatch(
  clientNamespace: string,
  authoritativeNamespace: string
): ResolveChatNamespaceOutcome | null {
  const clientTrimmed = clientNamespace.trim();
  if (
    clientTrimmed !== "" &&
    normalizeAssistantNamespace(clientTrimmed) !== authoritativeNamespace
  ) {
    return {
      ok: false,
      status: 403,
      message: "namespace does not match authenticated workspace.",
    };
  }
  return null;
}

/**
 * Authoritative namespace for chat ACL and future per-ns quota.
 *
 * Authenticity (always):
 * - Valid client kubeconfig YAML
 * - Client `namespace` consistent with kubeconfig `current-context` when set
 *
 * Then one of:
 * - **Sealos Desktop iframe:** the client kubeconfig comes from `sealosApp.getSession()`;
 *   namespace comes from the kubeconfig current context.
 * - **Dev bypass:** optional match against `NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG`;
 *   namespace from kubeconfig context.
 */
export async function resolveAuthoritativeChatNamespace(options: {
  encodedKubeconfig: string | undefined;
  clientNamespace: string;
  verify?: VerifyKubeconfigNamespace;
}): Promise<ResolveChatNamespaceOutcome> {
  const useDevCredentialBypass = hasDevCredentialBypass();
  const devCredentials = useDevCredentialBypass
    ? devCredentialsFromEnv()
    : undefined;
  const clientNamespace = options.clientNamespace.trim();
  const authorization = await authorizeKubeconfigNamespace({
    encodedKubeconfig: options.encodedKubeconfig,
    expectedNamespace:
      clientNamespace === "" ? undefined : options.clientNamespace,
    normalizeNamespace: normalizeAssistantNamespace,
    verify: useDevCredentialBypass
      ? () => {
          if (
            devCredentials != null &&
            devCredentials.encodedKubeconfig !== "" &&
            !kubeconfigCredentialsMatch(
              options.encodedKubeconfig,
              devCredentials.encodedKubeconfig
            )
          ) {
            return Promise.resolve({
              message: "kubeconfig does not match local dev credentials.",
              ok: false as const,
              status: 403,
            });
          }
          return Promise.resolve({ ok: true as const });
        }
      : options.verify,
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

  if (devCredentials != null) {
    const authoritativeNamespace =
      devCredentials.namespace === ""
        ? authorization.namespace
        : normalizeAssistantNamespace(devCredentials.namespace);

    const nsMismatch = rejectClientNamespaceMismatch(
      options.clientNamespace,
      authoritativeNamespace
    );
    if (nsMismatch != null) {
      return nsMismatch;
    }

    return { ok: true, namespace: authoritativeNamespace };
  }

  return { ok: true, namespace: authorization.namespace };
}
