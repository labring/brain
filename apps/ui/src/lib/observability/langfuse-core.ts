export const DEFAULT_LANGFUSE_BASE_URL = "https://cloud.langfuse.com";
const TRAILING_SLASHES = /\/+$/;

export type LangfuseEnv = Record<string, string | undefined>;

export interface LangfuseConfig {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

/**
 * Resolves the Chat Assistant Langfuse configuration without exposing
 * credentials to callers that only need to decide whether tracing is enabled.
 * A partial key pair is intentionally treated as disabled so observability
 * cannot prevent the application from serving traffic.
 */
export function getLangfuseConfigFromEnv(
  env: LangfuseEnv
): LangfuseConfig | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim() ?? "";
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim() ?? "";

  if (publicKey === "" || secretKey === "") {
    return null;
  }

  return {
    publicKey,
    secretKey,
    baseUrl:
      env.LANGFUSE_BASE_URL?.trim().replace(TRAILING_SLASHES, "") ||
      DEFAULT_LANGFUSE_BASE_URL,
  };
}

export function isLangfusePartiallyConfiguredFromEnv(
  env: LangfuseEnv
): boolean {
  const hasPublicKey = (env.LANGFUSE_PUBLIC_KEY?.trim() ?? "") !== "";
  const hasSecretKey = (env.LANGFUSE_SECRET_KEY?.trim() ?? "") !== "";
  return hasPublicKey !== hasSecretKey;
}
