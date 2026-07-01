import { normalizeAssistantNamespace } from "@/lib/chat-persistence/types";
import { decodeKubeconfig } from "@/lib/chat-runtime/kubeconfig";
import { namespaceFromKubeconfigText } from "@/lib/chat-runtime/kubeconfig-namespace-core";
import type { ServerCredentials } from "@/lib/server-credentials";

export type GithubNamespaceAuthorization =
  | { namespace: string; ok: true; serverEncodedKubeconfig: string }
  | { error: string; ok: false; status: number };

export function authorizeGithubConnectionNamespace(
  requestedNamespace: string | null | undefined,
  credentials: Pick<
    ServerCredentials,
    "serverEncodedKubeconfig" | "serverNamespace"
  >
): GithubNamespaceAuthorization {
  const requested = requestedNamespace?.trim() ?? "";
  if (requested === "") {
    return {
      error: "Missing namespace.",
      ok: false,
      status: 400,
    };
  }

  const kubeconfig = decodeKubeconfig(credentials.serverEncodedKubeconfig);
  if (kubeconfig == null) {
    return {
      error: "Authentication is required.",
      ok: false,
      status: 401,
    };
  }

  const namespace =
    namespaceFromKubeconfigText(kubeconfig) ??
    credentials.serverNamespace.trim();
  if (namespace === "") {
    return {
      error: "Could not resolve namespace from authenticated workspace.",
      ok: false,
      status: 400,
    };
  }

  const authoritativeNamespace = normalizeAssistantNamespace(namespace);
  if (normalizeAssistantNamespace(requested) !== authoritativeNamespace) {
    return {
      error: "namespace does not match authenticated workspace.",
      ok: false,
      status: 403,
    };
  }

  return {
    namespace: authoritativeNamespace,
    ok: true,
    serverEncodedKubeconfig: credentials.serverEncodedKubeconfig,
  };
}
