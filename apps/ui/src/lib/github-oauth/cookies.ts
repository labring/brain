import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const STATE_COOKIE = "github_oauth_state";
const CODE_VERIFIER_COOKIE = "github_oauth_code_verifier";
const RETURN_PATH_COOKIE = "github_oauth_return";
const NAMESPACE_COOKIE = "github_oauth_namespace";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 10,
  path: "/",
};

export interface CallbackCookies {
  codeVerifier: string | undefined;
  namespace: string | undefined;
  returnPath: string | undefined;
  state: string | undefined;
}

export async function readCallbackCookies(): Promise<CallbackCookies> {
  const store = await cookies();
  return {
    state: store.get(STATE_COOKIE)?.value,
    codeVerifier: store.get(CODE_VERIFIER_COOKIE)?.value,
    returnPath: store.get(RETURN_PATH_COOKIE)?.value,
    namespace: store.get(NAMESPACE_COOKIE)?.value,
  };
}

export function setAuthorizeCookies(
  response: NextResponse,
  args: {
    codeVerifier: string;
    namespace: string | null;
    returnPath: string | null;
    state: string;
  }
): void {
  response.cookies.set(STATE_COOKIE, args.state, COOKIE_OPTS);
  response.cookies.set(CODE_VERIFIER_COOKIE, args.codeVerifier, COOKIE_OPTS);
  if (args.returnPath) {
    response.cookies.set(RETURN_PATH_COOKIE, args.returnPath, COOKIE_OPTS);
  } else {
    response.cookies.delete(RETURN_PATH_COOKIE);
  }
  if (args.namespace) {
    response.cookies.set(NAMESPACE_COOKIE, args.namespace, COOKIE_OPTS);
  } else {
    response.cookies.delete(NAMESPACE_COOKIE);
  }
}

export function clearOAuthCookies(response: NextResponse): void {
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(CODE_VERIFIER_COOKIE);
  response.cookies.delete(RETURN_PATH_COOKIE);
  response.cookies.delete(NAMESPACE_COOKIE);
}
