import { NextResponse } from "next/server";

import {
  getGithubConnectionForNamespace,
  revokeGithubConnectionForNamespace,
} from "@/features/deploy/github/connection-service";
import { resolveGithubConnectionIdentity } from "@/features/deploy/github/namespace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const identity = await resolveGithubConnectionIdentity(
    request,
    searchParams.get("namespace"),
    searchParams.get("userId")
  );
  if (!identity.ok) {
    return jsonError(identity.error, identity.status);
  }
  const connection = await getGithubConnectionForNamespace(
    identity.namespace,
    identity.userId
  );
  return NextResponse.json({ connection });
}

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
