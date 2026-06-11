import { SignJWT } from "jose";

export const DEVBOX_API_PREFIX = "/api/v1/devbox";

const DEFAULT_CHAT_DEVBOX_RESOURCE_CPU = "500m";
const DEFAULT_CHAT_DEVBOX_RESOURCE_MEMORY = "256Mi";
const DEFAULT_DEVBOX_TOKEN_TTL_SECONDS = 4 * 60 * 60;
const DNS_1123_LABEL_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const TRAILING_SLASHES_REGEX = /\/+$/;

export type DevboxEnv = Record<string, string | undefined>;

export interface ChatDevboxResource {
  cpu: string;
  memory: string;
}

function getRequiredEnv(env: DevboxEnv, name: keyof DevboxEnv): string {
  const value = env[name];
  if (value == null || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(TRAILING_SLASHES_REGEX, "");
}

export function getDevboxBaseUrlFromEnv(env: DevboxEnv): string {
  return normalizeBaseUrl(getRequiredEnv(env, "DEVBOX_API_BASE_URL"));
}

export function getDevboxDefaultImageFromEnv(
  env: DevboxEnv
): string | undefined {
  const image = env.DEVBOX_RUNTIME_IMAGE?.trim();
  return image === "" ? undefined : image;
}

export function getDevboxArchiveAfterPauseTimeFromEnv(env: DevboxEnv): string {
  return env.DEVBOX_ARCHIVE_AFTER_PAUSE_TIME?.trim() || "24h";
}

export function getChatDevboxResourceFromEnv(
  env: DevboxEnv
): ChatDevboxResource {
  return {
    cpu:
      env.CHAT_DEVBOX_RESOURCE_CPU?.trim() || DEFAULT_CHAT_DEVBOX_RESOURCE_CPU,
    memory:
      env.CHAT_DEVBOX_RESOURCE_MEMORY?.trim() ||
      DEFAULT_CHAT_DEVBOX_RESOURCE_MEMORY,
  };
}

export function validateDevboxAuthNamespace(namespace: string): string {
  const trimmed = namespace.trim();
  if (!DNS_1123_LABEL_REGEX.test(trimmed)) {
    throw new Error("Devbox auth namespace must be a valid DNS1123 label");
  }
  return trimmed;
}

export async function getDevboxAuthTokenFromEnv(
  env: DevboxEnv,
  namespace: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> {
  const staticToken = env.DEVBOX_TOKEN?.trim();
  if (staticToken != null && staticToken !== "") {
    return staticToken;
  }

  const signingKey = getRequiredEnv(env, "DEVBOX_JWT_SIGNING_KEY");
  const authNamespace = validateDevboxAuthNamespace(namespace);
  const ttlSeconds = Number.parseInt(
    env.DEVBOX_JWT_TTL_SECONDS ?? String(DEFAULT_DEVBOX_TOKEN_TTL_SECONDS),
    10
  );

  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("DEVBOX_JWT_TTL_SECONDS must be a positive integer");
  }

  const secret = new TextEncoder().encode(signingKey);

  return await new SignJWT({ namespace: authNamespace })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttlSeconds)
    .sign(secret);
}
