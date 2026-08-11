import { SignJWT } from "jose";

export const DEVBOX_API_PREFIX = "/api/v1/devbox";

const DEFAULT_DEVBOX_TOKEN_TTL_SECONDS = 4 * 60 * 60;
const DNS_1123_LABEL_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const TRAILING_SLASHES_REGEX = /\/+$/;

export type DevboxEnv = Record<string, string | undefined>;

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

/**
 * Whether this deployment can talk to a Devbox API at all.
 *
 * Mirrors what {@link getDevboxBaseUrlFromEnv} and
 * {@link getDevboxAuthTokenFromEnv} require, so background callers can skip
 * quietly instead of throwing on every invocation. On-demand callers (bash
 * tools) should still let the throw surface as a real tool error.
 */
export function isDevboxConfiguredFromEnv(env: DevboxEnv): boolean {
  const hasBaseUrl = (env.DEVBOX_API_BASE_URL?.trim() ?? "") !== "";
  const hasAuth =
    (env.DEVBOX_TOKEN?.trim() ?? "") !== "" ||
    (env.DEVBOX_JWT_SIGNING_KEY?.trim() ?? "") !== "";
  return hasBaseUrl && hasAuth;
}

export function getDevboxDefaultImageFromEnv(
  env: DevboxEnv
): string | undefined {
  const image = env.DEVBOX_RUNTIME_IMAGE?.trim();
  return image === "" ? undefined : image;
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
