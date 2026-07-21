import { normalizeAssistantNamespace } from "@/features/chat/persistence/types";
import {
  authorizeKubeconfigNamespace,
  encodedKubeconfigFromRequest,
  type VerifyKubeconfigNamespace,
} from "@/lib/request-kubeconfig-auth";

export type GithubConnectionAuthorization =
  | {
      namespace: string;
      ok: true;
      serverEncodedKubeconfig: string;
      userId: string;
    }
  | { error: string; ok: false; status: number };

export async function authorizeGithubConnectionIdentity(
  requestedNamespace: string | null | undefined,
  requestedUserId: string | null | undefined,
  credentials: {
    serverEncodedKubeconfig: string;
    serverNamespace?: string;
    verify?: VerifyKubeconfigNamespace;
  }
): Promise<GithubConnectionAuthorization> {
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

  const authorization = await authorizeKubeconfigNamespace({
    encodedKubeconfig: credentials.serverEncodedKubeconfig,
    expectedNamespace: requested,
    fallbackNamespace: credentials.serverNamespace,
    normalizeNamespace: normalizeAssistantNamespace,
    verify: credentials.verify,
  });
  if (!authorization.ok) {
    if (authorization.code === "verification_failed") {
      return {
        error: authorization.message,
        ok: false,
        status: authorization.status,
      };
    }
    if (
      authorization.code === "authentication_required" ||
      authorization.code === "invalid_kubeconfig"
    ) {
      return {
        error: "Authentication is required.",
        ok: false,
        status: 401,
      };
    }
    if (authorization.code === "namespace_unresolved") {
      return {
        error: "Could not resolve namespace from authenticated workspace.",
        ok: false,
        status: 400,
      };
    }
    return {
      error: "namespace does not match authenticated workspace.",
      ok: false,
      status: 403,
    };
  }

  return {
    namespace: authorization.namespace,
    ok: true,
    serverEncodedKubeconfig: credentials.serverEncodedKubeconfig,
    userId,
  };
}

export function credentialsWithRequestKubeconfig(request: Request): {
  serverEncodedKubeconfig: string;
  serverNamespace: string;
} {
  const requestEncodedKubeconfig = encodedKubeconfigFromRequest(request);
  return {
    serverEncodedKubeconfig: requestEncodedKubeconfig,
    serverNamespace: "",
  };
}
