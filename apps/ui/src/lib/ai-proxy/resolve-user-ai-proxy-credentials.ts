import "server-only";

import { fetchOrCreateAiProxyToken } from "./create-token";
import { aiProxyOpenAiBaseUrl } from "./endpoints";
import { clusterHostnameFromKubeconfigText } from "./kubeconfig-hostname";

const DEFAULT_AI_PROXY_TOKEN_NAME = "sealos-brain";

export interface UserAiProxyCredentials {
  apiKey: string;
  baseUrl: string;
}

export type ResolveUserAiProxyCredentialsOutcome =
  | { ok: true; credentials: UserAiProxyCredentials }
  | {
      ok: false;
      reason:
        | "invalid-kubeconfig"
        | "missing-kubeconfig"
        | "token-request-failed";
      status: number;
      /** Untrusted upstream text; callers decide whether it is safe to expose. */
      upstreamBodyText?: string;
    };

function trimmedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function resolveUserAiProxyCredentials(options: {
  encodedKubeconfig: string | undefined;
  kubeconfigText: string;
}): Promise<ResolveUserAiProxyCredentialsOutcome> {
  const authorizationEncodedKubeconfig = options.encodedKubeconfig?.trim();
  if (!authorizationEncodedKubeconfig) {
    return { ok: false, reason: "missing-kubeconfig", status: 400 };
  }

  const clusterHostname = clusterHostnameFromKubeconfigText(
    options.kubeconfigText
  );
  if (!clusterHostname) {
    return { ok: false, reason: "invalid-kubeconfig", status: 400 };
  }

  const configuredName =
    trimmedEnv(process.env.AI_PROXY_TOKEN_NAME) ?? DEFAULT_AI_PROXY_TOKEN_NAME;
  const tokenResult = await fetchOrCreateAiProxyToken({
    authorizationEncodedKubeconfig,
    clusterHostname,
    name: configuredName.slice(0, 100),
  });
  if (!tokenResult.ok) {
    const status =
      tokenResult.status >= 400 && tokenResult.status < 600
        ? tokenResult.status
        : 502;
    return {
      ok: false,
      reason: "token-request-failed",
      status,
      upstreamBodyText: tokenResult.bodyText,
    };
  }

  return {
    ok: true,
    credentials: {
      apiKey: tokenResult.token.key,
      baseUrl: aiProxyOpenAiBaseUrl(clusterHostname),
    },
  };
}
