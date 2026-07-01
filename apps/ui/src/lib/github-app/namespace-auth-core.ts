import { normalizeAssistantNamespace } from "@/lib/chat-persistence/types";
import { decodeKubeconfig } from "@/lib/chat-runtime/kubeconfig";
import { namespaceFromKubeconfigText } from "@/lib/chat-runtime/kubeconfig-namespace-core";
import { encodedKubeconfigFromRequest } from "@/lib/request-kubeconfig-auth";
import type { ServerCredentials } from "@/lib/server-credentials";

export type GithubConnectionAuthorization =
  | {
      namespace: string;
      ok: true;
      serverEncodedKubeconfig: string;
      userId: string;
    }
  | { error: string; ok: false; status: number };

export function authorizeGithubConnectionIdentity(
  requestedNamespace: string | null | undefined,
  requestedUserId: string | null | undefined,
  credentials: Pick<
    ServerCredentials,
    "serverEncodedKubeconfig" | "serverNamespace"
  >
): GithubConnectionAuthorization {
  const requested = requestedNamespace?.trim() ?? "";
  if (requested === "") {
    return {
      error: "Missing namespace.",
      ok: false,
      status: 400,
    };
  }

  const userId = requestedUserId?.trim() ?? "";
  if (userId === "") {
    return {
      error: "Missing user ID.",
      ok: false,
      status: 400,
    };
  }
  if (userId.length > 256) {
    return {
      error: "User ID is too long.",
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
    userId,
  };
}

export function credentialsWithRequestKubeconfig(
  request: Request,
  credentials: Pick<
    ServerCredentials,
    "serverEncodedKubeconfig" | "serverNamespace"
  >
): Pick<ServerCredentials, "serverEncodedKubeconfig" | "serverNamespace"> {
  const requestEncodedKubeconfig = encodedKubeconfigFromRequest(request);
  if (requestEncodedKubeconfig === "") {
    return credentials;
  }
  return {
    serverEncodedKubeconfig: requestEncodedKubeconfig,
    serverNamespace: credentials.serverNamespace,
  };
}
