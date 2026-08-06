import "server-only";

import {
  DEVBOX_API_PREFIX,
  getDevboxAuthTokenFromEnv,
  getDevboxBaseUrlFromEnv,
  getDevboxDefaultImageFromEnv,
  isDevboxConfiguredFromEnv,
} from "./config-core";

export function isDevboxConfigured(): boolean {
  return isDevboxConfiguredFromEnv(process.env);
}

export function getDevboxBaseUrl(): string {
  return getDevboxBaseUrlFromEnv(process.env);
}

export function getDevboxApiPrefix(): string {
  return DEVBOX_API_PREFIX;
}

export function getDevboxDefaultImage(): string | undefined {
  return getDevboxDefaultImageFromEnv(process.env);
}

export async function getDevboxAuthToken(namespace: string): Promise<string> {
  return await getDevboxAuthTokenFromEnv(process.env, namespace);
}
