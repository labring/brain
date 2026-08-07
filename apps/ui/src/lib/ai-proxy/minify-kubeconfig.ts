import { parse, stringify } from "yaml";

interface KubeconfigDocument {
  clusters?: Array<{ name?: unknown; cluster?: Record<string, unknown> }>;
  contexts?: Array<{
    name?: unknown;
    context?: { cluster?: unknown; user?: unknown; namespace?: unknown };
  }>;
  "current-context"?: unknown;
  users?: Array<{ name?: unknown; user?: Record<string, unknown> }>;
}

/**
 * Reduces a kubeconfig to its current context before it travels as an HTTP
 * Authorization header. The full kubeconfig (often tens of KB with CA and
 * client certificates) can exceed the gateway's header-size limit when
 * percent-encoded, which silently kills the AI Proxy token request. Keeping
 * only the active cluster/user/context preserves everything the AI Proxy
 * verifier needs while shrinking the header to a few KB. Unparseable or
 * incomplete documents are returned unchanged so failures stay visible
 * instead of being masked by a silent rewrite.
 */
export function minifyKubeconfigForAiProxy(kubeconfigText: string): string {
  let document: KubeconfigDocument;
  try {
    document = parse(kubeconfigText) as KubeconfigDocument;
  } catch {
    return kubeconfigText;
  }
  const currentContextName = document["current-context"];
  const contexts = Array.isArray(document.contexts) ? document.contexts : [];
  const context = contexts.find(
    (candidate) => candidate?.name === currentContextName
  );
  const contextBody = context?.context;
  if (contextBody == null || typeof contextBody !== "object") {
    return kubeconfigText;
  }
  const clusters = Array.isArray(document.clusters) ? document.clusters : [];
  const cluster = clusters.find(
    (candidate) => candidate?.name === contextBody.cluster
  );
  const users = Array.isArray(document.users) ? document.users : [];
  const user = users.find((candidate) => candidate?.name === contextBody.user);
  if (cluster?.cluster == null || user?.user == null) {
    return kubeconfigText;
  }
  const mini = {
    apiVersion: "v1",
    kind: "Config",
    clusters: [{ name: cluster.name, cluster: cluster.cluster }],
    contexts: [
      {
        name: context?.name,
        context: { ...contextBody },
      },
    ],
    "current-context": currentContextName,
    users: [{ name: user.name, user: user.user }],
  };
  return stringify(mini);
}
