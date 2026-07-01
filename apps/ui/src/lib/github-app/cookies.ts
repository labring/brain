import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const STATE_COOKIE = "github_app_install_state";
const RETURN_PATH_COOKIE = "github_app_install_return";
const NAMESPACE_COOKIE = "github_app_install_namespace";
const USER_ID_COOKIE = "github_app_install_user_id";
const ENCODED_KUBECONFIG_COOKIE = "github_app_install_kubeconfig";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 10,
  path: "/",
};

export interface CallbackCookies {
  encodedKubeconfig: string | undefined;
  namespace: string | undefined;
  returnPath: string | undefined;
  state: string | undefined;
  userId: string | undefined;
}

export async function readCallbackCookies(): Promise<CallbackCookies> {
  const store = await cookies();
  return {
    state: store.get(STATE_COOKIE)?.value,
    encodedKubeconfig: store.get(ENCODED_KUBECONFIG_COOKIE)?.value,
    returnPath: store.get(RETURN_PATH_COOKIE)?.value,
    namespace: store.get(NAMESPACE_COOKIE)?.value,
    userId: store.get(USER_ID_COOKIE)?.value,
  };
}

export async function readInstallSessionCookies(): Promise<{
  encodedKubeconfig: string | undefined;
  userId: string | undefined;
}> {
  const store = await cookies();
  return {
    encodedKubeconfig: store.get(ENCODED_KUBECONFIG_COOKIE)?.value,
    userId: store.get(USER_ID_COOKIE)?.value,
  };
}

export function setInstallSessionCookies(
  response: NextResponse,
  args: { encodedKubeconfig: string; userId: string }
): void {
  response.cookies.set(
    ENCODED_KUBECONFIG_COOKIE,
    args.encodedKubeconfig,
    COOKIE_OPTS
  );
  response.cookies.set(USER_ID_COOKIE, args.userId, COOKIE_OPTS);
}

export function setAuthorizeCookies(
  response: NextResponse,
  args: {
    namespace: string | null;
    returnPath: string | null;
    state: string;
    userId: string;
  }
): void {
  response.cookies.set(STATE_COOKIE, args.state, COOKIE_OPTS);
  response.cookies.set(USER_ID_COOKIE, args.userId, COOKIE_OPTS);
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

export function clearInstallCookies(response: NextResponse): void {
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(RETURN_PATH_COOKIE);
  response.cookies.delete(NAMESPACE_COOKIE);
  response.cookies.delete(USER_ID_COOKIE);
  response.cookies.delete(ENCODED_KUBECONFIG_COOKIE);
}
