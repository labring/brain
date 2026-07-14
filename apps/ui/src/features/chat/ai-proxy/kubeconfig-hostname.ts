import { parse } from "yaml";

interface KubeconfigYaml {
  clusters?: Array<{ name: string; cluster?: { server?: string } }>;
  contexts?: Array<{ name: string; context?: { cluster?: string } }>;
  "current-context"?: string;
}

/** Returns the kubeconfig cluster `server` host (no port), e.g. https://foo:6443 → foo */
export function clusterHostnameFromKubeconfigText(
  yamlText: string
): string | null {
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
  const current = kc["current-context"];
  if (!current?.trim()) {
    return null;
  }

  const contextEntry = kc.contexts?.find((c) => c.name === current);
  const clusterRef = contextEntry?.context?.cluster;
  if (!clusterRef?.trim()) {
    return null;
  }

  const cluster = kc.clusters?.find((c) => c.name === clusterRef);
  const server = cluster?.cluster?.server;
  if (!server?.trim()) {
    return null;
  }

  try {
    return new URL(server).hostname || null;
  } catch {
    return null;
  }
}
