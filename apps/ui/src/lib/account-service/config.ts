import "server-only";

import {
  type AccountServiceConfig,
  assertProductionAccountServiceConfig as assertProductionAccountServiceConfigFromEnv,
  getAccountServiceConfigFromEnv,
  isAccountServiceConfiguredFromEnv,
} from "./config-core";

export function getAccountServiceConfig(): AccountServiceConfig {
  return getAccountServiceConfigFromEnv(process.env);
}

export function isAccountServiceConfigured(): boolean {
  return isAccountServiceConfiguredFromEnv(process.env);
}

export function assertProductionAccountServiceConfig(): void {
  assertProductionAccountServiceConfigFromEnv(process.env);
}
