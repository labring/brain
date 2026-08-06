import {
  type AppTokenVerificationConfig,
  appTokenFromRequest,
} from "./app-token";
import {
  IdentityBindingSupersededError,
  type ObserveIdentityFingerprint,
} from "./identity-fingerprint-core";
import {
  authorizeWorkspaceActor,
  encodedKubeconfigFromRequest,
  type VerifyKubeconfigNamespace,
} from "./request-kubeconfig-auth";
import type { VerifiedWorkspaceActorAuthorization } from "./verified-personal-actor";

/**
 * Shared HTTP surface for personal-resource route handlers — the server-side
 * counterpart of `personal-resource-headers.ts`. Every personal-resource
 * feature (onboarding profile, assistant conversations, GitHub connections)
 * answers failures with the same `{ code, error }` envelope and enters
 * through the same workspace-actor authorization step.
 */

export function jsonError(input: {
  code: string;
  message: string;
  status: number;
}): Response {
  return Response.json(
    { code: input.code, error: input.message },
    { status: input.status }
  );
}

/** The write found the binding superseded by a concurrent merge (ADR-0059). */
export function supersededBindingResponse(error: unknown): Response | null {
  return error instanceof IdentityBindingSupersededError
    ? jsonError({
        code: "app_token_superseded",
        message: "Authentication is required.",
        status: 401,
      })
    : null;
}

export interface PersonalResourceAuthorizationOptions {
  /** Test seam; defaults to `JWT_INTERNAL` from the env. */
  appTokenConfig?: AppTokenVerificationConfig | null;
  normalizeNamespace?: (namespace: string) => string;
  /** Test seam; defaults to the region-local Identity Fingerprint store. */
  observeFingerprint?: ObserveIdentityFingerprint;
  verify?: VerifyKubeconfigNamespace;
}

/**
 * Authorizes one personal-resource request through the workspace-actor choke
 * point, reading credentials and the expected `namespace` query parameter
 * from the request. A failure arrives already mapped onto the shared error
 * envelope; callers only map the verified authorization onto their own actor
 * shape.
 */
export async function authorizePersonalResourceRequest(
  request: Request,
  options: PersonalResourceAuthorizationOptions
): Promise<
  | { authorization: VerifiedWorkspaceActorAuthorization; ok: true }
  | { ok: false; response: Response }
> {
  const clientNamespace = new URL(request.url).searchParams.get("namespace");
  const authorization = await authorizeWorkspaceActor({
    appToken: appTokenFromRequest(request),
    appTokenConfig: options.appTokenConfig,
    encodedKubeconfig: encodedKubeconfigFromRequest(request),
    expectedNamespace: clientNamespace?.trim() || undefined,
    normalizeNamespace: options.normalizeNamespace,
    observeFingerprint: options.observeFingerprint,
    verify: options.verify,
  });
  if (!authorization.ok) {
    return {
      ok: false,
      response: jsonError({
        code: authorization.code,
        message: authorization.message,
        status: authorization.status,
      }),
    };
  }
  return { authorization, ok: true };
}
