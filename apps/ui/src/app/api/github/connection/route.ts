import { NextResponse } from "next/server";

import {
  getGithubConnectionStatusForWorkspaceActor,
  revokeGithubConnectionForNamespace,
} from "@/features/deploy/github/connection-service";
import { createGithubConnectionStatusHandler } from "@/features/deploy/github/connection-status-handler";
import { resolveGithubConnectionIdentity } from "@/features/deploy/github/namespace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export const GET = createGithubConnectionStatusHandler({
  getConnection: getGithubConnectionStatusForWorkspaceActor,
});

export async function DELETE(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const identity = await resolveGithubConnectionIdentity(
    request,
    searchParams.get("namespace"),
    searchParams.get("userId")
  );
  if (!identity.ok) {
    return jsonError(identity.error, identity.status);
  }
  await revokeGithubConnectionForNamespace(identity.namespace, identity.userId);
  return NextResponse.json({ connection: null });
}
