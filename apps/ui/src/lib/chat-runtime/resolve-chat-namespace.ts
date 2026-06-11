import "server-only";

import { normalizeAssistantNamespace } from "@/lib/chat-persistence/types";
import {
  devCredentialsFromEnv,
  hasDevCredentialBypass,
} from "@/lib/server-credentials";

import { decodeKubeconfig } from "./kubeconfig";
import { kubeconfigCredentialsMatch } from "./kubeconfig-identity";
import { namespaceFromKubeconfigText } from "./kubeconfig-namespace";

export type ResolveChatNamespaceOutcome =
  | { ok: true; namespace: string }
  | { ok: false; status: number; message: string };

/**
 * Parses kubeconfig YAML and ensures the client `namespace` field matches
 * `current-context` inside the same blob (consistency only, not authenticity).
 */
export function resolveChatNamespaceFromKubeconfigText(options: {
  kubeconfigText: string;
  clientNamespace: string;
}): ResolveChatNamespaceOutcome {
  const fromKubeconfig = namespaceFromKubeconfigText(options.kubeconfigText);
  if (fromKubeconfig == null) {
    return {
      ok: false,
      status: 400,
      message:
        "Could not resolve namespace from kubeconfig (missing or invalid current-context).",
    };
  }

  const namespace = normalizeAssistantNamespace(fromKubeconfig);
  const clientTrimmed = options.clientNamespace.trim();
  if (
    clientTrimmed !== "" &&
    normalizeAssistantNamespace(clientTrimmed) !== namespace
  ) {
    return {
      ok: false,
      status: 403,
      message: "namespace does not match kubeconfig current context.",
    };
  }

  return { ok: true, namespace };
}

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
export function resolveAuthoritativeChatNamespace(options: {
  encodedKubeconfig: string | undefined;
  clientNamespace: string;
}): ResolveChatNamespaceOutcome {
  const kubeconfigText = decodeKubeconfig(options.encodedKubeconfig);
  if (kubeconfigText == null) {
    return {
      ok: false,
      status: 400,
      message: "Missing or invalid kubeconfig",
    };
  }

  const parsed = resolveChatNamespaceFromKubeconfigText({
    kubeconfigText,
    clientNamespace: options.clientNamespace,
  });
  if (!parsed.ok) {
    return parsed;
  }

  if (hasDevCredentialBypass()) {
    const dev = devCredentialsFromEnv();
    if (
      dev.encodedKubeconfig !== "" &&
      !kubeconfigCredentialsMatch(
        options.encodedKubeconfig,
        dev.encodedKubeconfig
      )
    ) {
      return {
        ok: false,
        status: 403,
        message: "kubeconfig does not match local dev credentials.",
      };
    }

    const authoritativeNamespace =
      dev.namespace === ""
        ? parsed.namespace
        : normalizeAssistantNamespace(dev.namespace);

    const nsMismatch = rejectClientNamespaceMismatch(
      options.clientNamespace,
      authoritativeNamespace
    );
    if (nsMismatch != null) {
      return nsMismatch;
    }

    return { ok: true, namespace: authoritativeNamespace };
  }

  return { ok: true, namespace: parsed.namespace };
}
