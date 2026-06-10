import { decodeKubeconfig } from "./kubeconfig";

/** Canonical YAML text for comparing kubeconfig credentials (decoded, trimmed). */
export function kubeconfigYamlFromEncoded(
  encoded: string | undefined
): string | null {
  const trimmed = encoded?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }
  const decoded = decodeKubeconfig(trimmed);
  if (decoded != null) {
    return decoded.trim();
  }
  if (trimmed.includes("apiVersion:")) {
    return trimmed;
  }
  return null;
}

export function kubeconfigCredentialsMatch(
  encodedA: string | undefined,
  encodedB: string | undefined
): boolean {
  const yamlA = kubeconfigYamlFromEncoded(encodedA);
  const yamlB = kubeconfigYamlFromEncoded(encodedB);
  return yamlA != null && yamlB != null && yamlA === yamlB;
}
