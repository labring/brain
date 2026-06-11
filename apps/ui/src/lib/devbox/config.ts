import "server-only";

import {
  type ChatDevboxResource,
  DEVBOX_API_PREFIX,
  getChatDevboxResourceFromEnv,
  getDevboxArchiveAfterPauseTimeFromEnv,
  getDevboxAuthTokenFromEnv,
  getDevboxBaseUrlFromEnv,
  getDevboxDefaultImageFromEnv,
} from "./config-core";

export function getDevboxBaseUrl(): string {
  return getDevboxBaseUrlFromEnv(process.env);
}

export function getDevboxApiPrefix(): string {
  return DEVBOX_API_PREFIX;
}

export function getDevboxDefaultImage(): string | undefined {
  return getDevboxDefaultImageFromEnv(process.env);
}

export function getDevboxArchiveAfterPauseTime(): string | undefined {
  return getDevboxArchiveAfterPauseTimeFromEnv(process.env);
}

export function getChatDevboxResource(): ChatDevboxResource {
  return getChatDevboxResourceFromEnv(process.env);
}

export async function getDevboxAuthToken(namespace: string): Promise<string> {
  return await getDevboxAuthTokenFromEnv(process.env, namespace);
}
