import "server-only";

import { decodeKubeconfig } from "@/lib/kubeconfig";
import { encodedKubeconfigFromRequest } from "@/lib/request-kubeconfig-auth";
import { resolveAuthoritativeChatNamespace } from "@/lib/resolve-chat-namespace";

export interface DeployTaskRequestNamespace {
  message?: string;
  namespace?: string;
  ok: boolean;
  status?: number;
}

export async function resolveDeployTaskRequestNamespace(input: {
  clientNamespace?: string;
  encodedKubeconfig?: string;
}): Promise<DeployTaskRequestNamespace> {
  const kubeconfig = decodeKubeconfig(input.encodedKubeconfig);
  if (kubeconfig == null) {
    return {
      message: "Missing or invalid kubeconfig",
      ok: false,
      status: 400,
    };
  }

  const namespaceResolved = await resolveAuthoritativeChatNamespace({
    clientNamespace: input.clientNamespace ?? "",
    encodedKubeconfig: input.encodedKubeconfig,
  });
  if (!namespaceResolved.ok) {
    return {
      message: namespaceResolved.message,
      ok: false,
      status: namespaceResolved.status,
    };
  }

  return {
    namespace: namespaceResolved.namespace,
    ok: true,
  };
}

export function deployTaskRequestParams(request: Request): {
  encodedKubeconfig?: string;
  namespace?: string;
} {
  const url = new URL(request.url);
  const headerEncodedKubeconfig = encodedKubeconfigFromRequest(request);
  return {
    encodedKubeconfig:
      headerEncodedKubeconfig ||
      url.searchParams.get("encodedKubeconfig") ||
      undefined,
    namespace: url.searchParams.get("namespace") ?? undefined,
  };
}
