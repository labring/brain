const TRAILING_SLASHES_REGEX = /\/+$/;

export type AccountServiceEnv = Record<string, string | undefined>;

export interface AccountServiceConfig {
  baseUrl: string;
  signingSecret: string;
}

function getRequiredEnv(
  env: AccountServiceEnv,
  name: keyof AccountServiceEnv
): string {
  const value = env[name]?.trim() ?? "";
  if (value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getAccountServiceConfigFromEnv(
  env: AccountServiceEnv
): AccountServiceConfig {
  return {
    baseUrl: getRequiredEnv(env, "ACCOUNT_API_BASE_URL").replace(
      TRAILING_SLASHES_REGEX,
      ""
    ),
    signingSecret: getRequiredEnv(env, "JWT_INTERNAL"),
  };
}

export function isAccountServiceConfiguredFromEnv(
  env: AccountServiceEnv
): boolean {
  return (
    (env.ACCOUNT_API_BASE_URL?.trim() ?? "") !== "" &&
    (env.JWT_INTERNAL?.trim() ?? "") !== ""
  );
}

export function assertProductionAccountServiceConfig(
  env: AccountServiceEnv
): void {
  if (env.NODE_ENV === "production") {
    getAccountServiceConfigFromEnv(env);
  }
}
