import "server-only";

import {
  kubeconfigCredentialsMatch as kubeconfigCredentialsMatchCore,
  kubeconfigYamlFromEncoded as kubeconfigYamlFromEncodedCore,
} from "./kubeconfig-identity-core";

/** Canonical YAML text for comparing kubeconfig credentials (decoded, trimmed). */
export function kubeconfigYamlFromEncoded(
  encoded: string | undefined
): string | null {
  return kubeconfigYamlFromEncodedCore(encoded);
}

export function kubeconfigCredentialsMatch(
  encodedA: string | undefined,
  encodedB: string | undefined
): boolean {
  return kubeconfigCredentialsMatchCore(encodedA, encodedB);
}
