import { parse } from "yaml";

interface KubeconfigContext {
  cluster?: string;
  namespace?: string;
  user?: string;
}

interface KubeconfigYaml {
  contexts?: Array<{ name: string; context?: KubeconfigContext }>;
  "current-context"?: string;
}

/** Kubernetes default when the active context omits `namespace`. */
export const KUBECONFIG_DEFAULT_NAMESPACE = "default";

/**
 * Namespace from the kubeconfig's `current-context` entry (YAML parse only).
 * Returns `default` when the context has no explicit namespace.
 */
export function namespaceFromKubeconfigText(yamlText: string): string | null {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return null;
  }

  const kc = doc as KubeconfigYaml;
  const current = kc["current-context"]?.trim();
  if (!current) {
    return null;
  }

  const contextEntry = kc.contexts?.find((c) => c.name === current);
  if (contextEntry == null) {
    return null;
  }

  const ns = contextEntry.context?.namespace?.trim();
  return ns && ns.length > 0 ? ns : KUBECONFIG_DEFAULT_NAMESPACE;
}
