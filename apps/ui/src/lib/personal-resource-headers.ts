import { appTokenRequestHeaders } from "./app-token-header";
import { kubeconfigBearerHeader } from "./kubeconfig-header";

export interface PersonalResourceCredentials {
  appToken: string;
  kubeconfig: string;
}

export interface WorkspaceCredentials extends PersonalResourceCredentials {
  namespace: string;
}

export function hasWorkspaceCredentials(
  credentials: WorkspaceCredentials
): boolean {
  return (
    credentials.namespace.trim() !== "" &&
    credentials.appToken.trim() !== "" &&
    credentials.kubeconfig.trim() !== ""
  );
}

/**
 * Personal-resource routes authorize the caller from the kubeconfig bearer
 * token plus the desktop-minted App Token (ADR-0059), so their fetchers send
 * both on every request.
 */
export function personalResourceAuthHeaders(
  input: PersonalResourceCredentials
): Record<string, string> {
  return {
    Authorization: kubeconfigBearerHeader(input.kubeconfig),
    ...appTokenRequestHeaders(input.appToken),
  };
}
