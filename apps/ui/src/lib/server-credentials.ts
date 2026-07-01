import "server-only";

import { namespaceFromKubeconfigText } from "@/lib/chat-runtime/kubeconfig-namespace-core";

function envTrimDecoded(raw: string | undefined): string {
  try {
    return decodeURIComponent(raw ?? "").trim();
  } catch {
    return (raw ?? "").trim();
  }
}

/** Local dev can bypass Desktop SDK when `NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG` is set. */
export function hasDevCredentialBypass(): boolean {
  return envTrimDecoded(process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG) !== "";
}

/** Local dev overrides (`AuthBootstrap`); production auth comes from Desktop SDK. */
export function devCredentialsFromEnv(): {
  encodedKubeconfig: string;
  namespace: string;
} {
  const encodedKubeconfig = envTrimDecoded(
    process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG
  );
  return {
    encodedKubeconfig,
    namespace: namespaceFromKubeconfigText(encodedKubeconfig) ?? "",
  };
}
