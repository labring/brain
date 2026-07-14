import "server-only";

import { encodedKubeconfigFromRequest } from "@/lib/request-kubeconfig-auth";

import {
  type ResolveChatNamespaceOutcome,
  resolveAuthoritativeChatNamespace,
} from "@/lib/resolve-chat-namespace";

/**
 * Authorize a namespace-scoped chat BFF request (session / threads / messages /
 * thread). Reads the kubeconfig from the `Authorization: Bearer` header and runs
 * it through {@link resolveAuthoritativeChatNamespace} — the same authority the
 * main `POST /api/chat` route applies (kubeconfig authenticity + K8s RBAC access
 * review, with the local dev-credential bypass).
 *
 * Returns the *authoritative* namespace to key persistence by. The client-supplied
 * `namespace` must never partition data past this gate — that is the IDOR the four
 * sibling routes previously allowed by trusting the raw query/body value.
 */
export function authorizeChatRequestNamespace(
  request: Request,
  clientNamespace: string
): Promise<ResolveChatNamespaceOutcome> {
  return resolveAuthoritativeChatNamespace({
    clientNamespace,
    encodedKubeconfig: encodedKubeconfigFromRequest(request),
  });
}
