import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  getGithubAppInstallationMetadata,
  getGithubAppMetadata,
} from "./app-auth";
import { upsertGithubAppConnection } from "./connection-service";
import {
  consumeGithubAppInstallSession,
  createGithubAppInstallSession,
} from "./install-session-service";
import { authorizeGithubConnectionIdentity } from "./namespace-auth-core";
import { parseInstallReturnPathParam } from "./types";
import { buildInstallPopupCompleteUrl, getCallbackBaseUrl } from "./urls";

const TRAILING_SLASH_RE = /\/+$/;

function jsonError(
  error: string,
  description: string,
  status: number
): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status }
  );
}

async function githubAppInstallUrl(state: string): Promise<string> {
  const app = await getGithubAppMetadata();
  const url = new URL(
    `${app.htmlUrl.replace(TRAILING_SLASH_RE, "")}/installations/new`
  );
  url.searchParams.set("state", state);
  return url.toString();
}

export async function createGithubAppInstallSessionUrl(input: {
  encodedKubeconfig: string;
  namespace: string;
  returnPath: string | null;
  userId: string;
}): Promise<{ installUrl: string; state: string }> {
  const identity = await authorizeGithubConnectionIdentity(
    input.namespace,
    input.userId,
    { serverEncodedKubeconfig: input.encodedKubeconfig }
  );
  if (!identity.ok) {
    throw new Error(identity.error);
  }

  const state = randomUUID();
  await createGithubAppInstallSession({
    namespace: identity.namespace,
    returnPath: parseInstallReturnPathParam(input.returnPath),
    state,
    userId: identity.userId,
  });
  return { installUrl: await githubAppInstallUrl(state), state };
}

/** Direct callback entry is rejected; install must start from an authenticated Desktop SDK session. */
export function startAuthorize(): NextResponse {
  return jsonError(
    "install_session_required",
    "GitHub App installation must start from an authenticated Desktop SDK session.",
    401
  );
}

/** Provider returned `?error=...` — redirect back to the opener. */
export function handleProviderError(request: Request): NextResponse {
  const baseUrl = getCallbackBaseUrl(request);
  const response = NextResponse.redirect(
    buildInstallPopupCompleteUrl(baseUrl, null)
  );
  return response;
}

/** Step 2 — verify state, store namespace GitHub App installation, redirect. */
export async function completeAuthorization(
  request: Request,
  args: {
    installationId: string | null;
    setupAction: string | null;
    state: string | null;
  }
): Promise<NextResponse> {
  const session = await consumeGithubAppInstallSession(args.state ?? "");
  if (session == null) {
    return jsonError(
      "invalid_state",
      "CSRF check failed. State mismatch or expired.",
      400
    );
  }
  const installationId = args.installationId?.trim() ?? "";
  if (installationId === "") {
    return jsonError(
      "missing_installation",
      "GitHub App installation ID was not returned.",
      400
    );
  }

  const installation = await getGithubAppInstallationMetadata(installationId);
  await upsertGithubAppConnection({
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    actorUserId: session.userId,
    installationId,
    namespace: session.namespace,
    repositorySelection: installation.repositorySelection,
  });

  const baseUrl = getCallbackBaseUrl(request);
  const response = NextResponse.redirect(
    buildInstallPopupCompleteUrl(baseUrl, session.returnPath)
  );
  return response;
}
