import { parse, stringify } from "yaml";

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

function parseKubeconfig(yamlText: string): KubeconfigYaml | null {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return null;
  }
  return doc as KubeconfigYaml;
}

/**
 * Namespace from the kubeconfig's `current-context` entry (YAML parse only).
 * Returns `default` when the context has no explicit namespace.
 */
export function namespaceFromKubeconfigText(yamlText: string): string | null {
  const kc = parseKubeconfig(yamlText);
  if (kc == null) {
    return null;
  }
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

/**
 * The kubeconfig with `contexts[0].context.namespace` set to `namespace` —
 * Desktop's own seven-line rewrite, mirrored (ADR-0083): a Desktop user's
 * kubeconfig has one context, so the first context is the current one, and
 * switching Workspaces changes only the namespace it points at. Returns
 * null when the text is not a kubeconfig with at least one context.
 */
export function rewriteKubeconfigContextNamespace(
  yamlText: string,
  namespace: string
): string | null {
  const kc = parseKubeconfig(yamlText);
  const first = kc?.contexts?.[0];
  if (kc == null || first == null || typeof first !== "object") {
    return null;
  }
  first.context = { ...first.context, namespace };
  return stringify(kc);
}
