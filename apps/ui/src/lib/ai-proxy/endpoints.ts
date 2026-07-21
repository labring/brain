const HTTPS_SCHEME = "https://";

/** Tokens API base: `https://aiproxy-web.<kube-api-host>/api/v2alpha/tokens` */
export function aiProxyTokensUrl(clusterHostname: string): string {
  return `${HTTPS_SCHEME}aiproxy-web.${clusterHostname}/api/v2alpha/tokens`;
}

/** OpenAI-compatible base URL for the AI SDK (`/v1` suffix included). */
export function aiProxyOpenAiBaseUrl(clusterHostname: string): string {
  return `${HTTPS_SCHEME}aiproxy.${clusterHostname}/v1`;
}
