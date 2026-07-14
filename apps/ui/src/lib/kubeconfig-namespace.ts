import "server-only";

import {
  KUBECONFIG_DEFAULT_NAMESPACE as DEFAULT_NAMESPACE,
  namespaceFromKubeconfigText as parseNamespaceFromKubeconfigText,
} from "./kubeconfig-namespace-core";

/**
 * Namespace from the kubeconfig's `current-context` entry (YAML parse only).
 * For authenticated chat/quota, use {@link resolveAuthoritativeChatNamespace}.
 * Returns `default` when the context has no explicit namespace.
 */
export const KUBECONFIG_DEFAULT_NAMESPACE = DEFAULT_NAMESPACE;
export const namespaceFromKubeconfigText = parseNamespaceFromKubeconfigText;
