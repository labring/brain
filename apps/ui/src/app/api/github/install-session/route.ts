import { NextResponse } from "next/server";

import { setInstallSessionCookies } from "@/lib/github-app/cookies";
import { authorizeGithubConnectionIdentity } from "@/lib/github-app/namespace-auth-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    encodedKubeconfig?: unknown;
    namespace?: unknown;
    userId?: unknown;
  } | null;
  const namespace = typeof body?.namespace === "string" ? body.namespace : "";
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const encodedKubeconfig =
    typeof body?.encodedKubeconfig === "string" ? body.encodedKubeconfig : "";

  const authorized = authorizeGithubConnectionIdentity(namespace, userId, {
    serverEncodedKubeconfig: encodedKubeconfig,
    serverNamespace: "",
  });
  if (!authorized.ok) {
    return jsonError(authorized.error, authorized.status);
  }

  const response = NextResponse.json({
    namespace: authorized.namespace,
    userId: authorized.userId,
  });
  setInstallSessionCookies(response, {
    encodedKubeconfig: authorized.serverEncodedKubeconfig,
    userId: authorized.userId,
  });
  return response;
}
