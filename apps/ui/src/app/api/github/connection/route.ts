import { NextResponse } from "next/server";

import {
  getGithubConnection,
  revokeGithubConnection,
} from "@/lib/github-oauth/connection-service";
import { resolveGithubConnectionNamespace } from "@/lib/github-oauth/namespace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const namespace = await resolveGithubConnectionNamespace(
    new URL(request.url).searchParams.get("namespace")
  );
  if (!namespace.ok) {
    return jsonError(namespace.error, namespace.status);
  }
  const connection = await getGithubConnection(namespace.namespace);
  return NextResponse.json({ connection });
}

export async function DELETE(request: Request) {
  const namespace = await resolveGithubConnectionNamespace(
    new URL(request.url).searchParams.get("namespace")
  );
  if (!namespace.ok) {
    return jsonError(namespace.error, namespace.status);
  }
  await revokeGithubConnection(namespace.namespace);
  return NextResponse.json({ connection: null });
}
