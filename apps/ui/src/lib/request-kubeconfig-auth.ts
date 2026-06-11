import { decodeKubeconfig } from "@/lib/chat-runtime/kubeconfig";
import { namespaceFromKubeconfigText } from "@/lib/chat-runtime/kubeconfig-namespace-core";

const BEARER_TOKEN_RE = /^Bearer\s+(.+)$/i;

export type KubeconfigNamespaceAuthorization =
  | {
      encodedKubeconfig: string;
      kubeconfig: string;
      namespace: string;
      ok: true;
    }
  | {
      message: string;
      ok: false;
      status: number;
    };

function bearerToken(header: string | null): string {
  const value = header?.trim() ?? "";
  if (value === "") {
    return "";
  }
  const match = BEARER_TOKEN_RE.exec(value);
  return match?.[1]?.trim() ?? "";
}

export function encodedKubeconfigFromRequest(request: Request): string {
  return bearerToken(request.headers.get("authorization"));
}

export function authorizeEncodedKubeconfigNamespace(input: {
  encodedKubeconfig: string | undefined;
  namespace: string;
  subject: string;
}): KubeconfigNamespaceAuthorization {
  const encodedKubeconfig = input.encodedKubeconfig?.trim() ?? "";
  if (encodedKubeconfig === "") {
    return {
      message: "Authentication is required.",
      ok: false,
      status: 401,
    };
  }

  const kubeconfig = decodeKubeconfig(encodedKubeconfig);
  if (kubeconfig == null) {
    return {
      message: "Invalid kubeconfig.",
      ok: false,
      status: 400,
    };
  }

  const namespace = namespaceFromKubeconfigText(kubeconfig);
  if (namespace == null) {
    return {
      message: "Could not resolve namespace from kubeconfig.",
      ok: false,
      status: 400,
    };
  }

  if (namespace.trim() !== input.namespace.trim()) {
    return {
      message: `${input.subject} namespace is not accessible.`,
      ok: false,
      status: 403,
    };
  }

  return {
    encodedKubeconfig,
    kubeconfig,
    namespace,
    ok: true,
  };
}

export function authorizeRequestNamespace(
  request: Request,
  input: {
    namespace: string;
    subject: string;
  }
): KubeconfigNamespaceAuthorization {
  return authorizeEncodedKubeconfigNamespace({
    encodedKubeconfig: encodedKubeconfigFromRequest(request),
    namespace: input.namespace,
    subject: input.subject,
  });
}
