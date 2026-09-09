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
 * A missing host or key is treated as disabled so observability
 * cannot prevent the application from serving traffic.
 */
export function getLangfuseConfigFromEnv(
  env: LangfuseEnv
): LangfuseConfig | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim() ?? "";
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim() ?? "";

  const baseUrl = env.LANGFUSE_HOST?.trim().replace(TRAILING_SLASHES, "") ?? "";

  if (publicKey === "" || secretKey === "" || baseUrl === "") {
    return null;
  }

  return {
    publicKey,
    secretKey,
    baseUrl,
  };
}
