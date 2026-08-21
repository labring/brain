import { compactVerify } from "jose";

/**
 * Desktop-minted App Token verification (ADR-0059). The token is an HS256 JWT
 * signed with the cluster-shared `JWT_INTERNAL`, proving the authenticated
 * crName's binding to the global `userUid`. Only the signature is enforced
 * cryptographically; `exp` is never enforced (the kubeconfig is the liveness
 * credential) and workspace claims are never read.
 */

import { APP_TOKEN_HEADER } from "./app-token-header";

export interface AppTokenVerificationConfig {
  secret: string;
}

/** Bare token from the personal-resource request header (no auth scheme). */
export function appTokenFromRequest(request: Request): string {
  return request.headers.get(APP_TOKEN_HEADER)?.trim() ?? "";
}

/**
 * The signing key is required deployment configuration; a missing key must
 * fail production startup rather than degrade to a fallback secret.
 */
export function appTokenVerificationConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): AppTokenVerificationConfig | null {
  const secret = env.JWT_INTERNAL?.trim() ?? "";
  return secret === "" ? null : { secret };
}

export function assertProductionAppTokenConfig(
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  if ((env.JWT_INTERNAL?.trim() ?? "") === "") {
    throw new Error(
      "App token verification requires JWT_INTERNAL in production."
    );
  }
}

/**
 * The proven `crName → userUid` binding, its minting time, and the signed
 * account-service `userId` claim when the desktop token carries one.
 */
export interface VerifiedAppTokenBinding {
  crName: string;
  mintedAt: number | null;
  userId: string | null;
  userUid: string;
}

export type AppTokenBindingVerification =
  | { binding: VerifiedAppTokenBinding; expired: boolean; ok: true }
  | {
      ok: false;
      reason: "actor_mismatch" | "missing" | "unverifiable";
    };

function tokenClaims(payload: Uint8Array): Record<string, unknown> | null {
  try {
    const claims: unknown = JSON.parse(new TextDecoder().decode(payload));
    return typeof claims === "object" &&
      claims != null &&
      !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export async function verifyAppTokenBinding(input: {
  config: AppTokenVerificationConfig | null;
  expectedCrName: string;
  token: string;
}): Promise<AppTokenBindingVerification> {
  const token = input.token.trim();
  if (token === "") {
    return { ok: false, reason: "missing" };
  }
  const secret = input.config?.secret.trim() ?? "";
  if (secret === "") {
    return { ok: false, reason: "unverifiable" };
  }

  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(
      token,
      new TextEncoder().encode(secret),
      { algorithms: ["HS256"] }
    ));
  } catch {
    return { ok: false, reason: "unverifiable" };
  }

  const claims = tokenClaims(payload);
  const userId = nonEmptyString(claims?.userId);
  const userUid = nonEmptyString(claims?.userUid);
  const userCrName = nonEmptyString(claims?.userCrName);
  if (userUid == null || userCrName == null) {
    return { ok: false, reason: "unverifiable" };
  }
  if (userCrName !== input.expectedCrName) {
    return { ok: false, reason: "actor_mismatch" };
  }

  const issuedAt = claims?.iat;
  const expiresAt = claims?.exp;
  return {
    binding: {
      crName: userCrName,
      mintedAt: typeof issuedAt === "number" ? issuedAt : null,
      userId,
      userUid,
    },
    expired: typeof expiresAt === "number" && expiresAt * 1000 < Date.now(),
    ok: true,
  };
}
