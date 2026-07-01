import { NextResponse } from "next/server";

import { listGithubReposForNamespace } from "@/lib/github-app/connection-service";
import { resolveGithubConnectionIdentity } from "@/lib/github-app/namespace-auth";

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
  try {
    const repos = await listGithubReposForNamespace(identity.namespace);
    return NextResponse.json({ repos });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not load GitHub repos.",
      401
    );
  }
}
