import { NextResponse } from "next/server";

import { authorizeGithubConnectionIdentity } from "@/lib/github-app/namespace-auth-core";
import { createGithubAppInstallSessionUrl } from "@/lib/github-app/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    encodedKubeconfig?: unknown;
    namespace?: unknown;
    returnPath?: unknown;
    userId?: unknown;
  } | null;
  const namespace = typeof body?.namespace === "string" ? body.namespace : "";
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const encodedKubeconfig =
    typeof body?.encodedKubeconfig === "string" ? body.encodedKubeconfig : "";

  const authorized = await authorizeGithubConnectionIdentity(
    namespace,
    userId,
    {
      serverEncodedKubeconfig: encodedKubeconfig,
      serverNamespace: "",
    }
  );
  if (!authorized.ok) {
    return jsonError(authorized.error, authorized.status);
  }

  const install = await createGithubAppInstallSessionUrl({
    encodedKubeconfig: authorized.serverEncodedKubeconfig,
    namespace: authorized.namespace,
    returnPath: typeof body?.returnPath === "string" ? body.returnPath : null,
    userId: authorized.userId,
  });
  return NextResponse.json({
    installUrl: install.installUrl,
    namespace: authorized.namespace,
    state: install.state,
    userId: authorized.userId,
  });
}
