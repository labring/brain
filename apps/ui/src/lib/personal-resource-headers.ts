import { appTokenRequestHeaders } from "./app-token-header";
import { kubeconfigBearerHeader } from "./kubeconfig-header";

/**
 * Personal-resource routes authorize the caller from the kubeconfig bearer
 * token plus the desktop-minted App Token (ADR-0059), so their fetchers send
 * both on every request.
 */
export function personalResourceAuthHeaders(input: {
  appToken: string;
  kubeconfig: string;
}): Record<string, string> {
  return {
    Authorization: kubeconfigBearerHeader(input.kubeconfig),
    ...appTokenRequestHeaders(input.appToken),
  };
}
