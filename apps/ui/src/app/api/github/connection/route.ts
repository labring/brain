import { NextResponse } from "next/server";

import {
  getGithubConnection,
  revokeGithubConnection,
} from "@/lib/github-oauth/connection-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const namespace = new URL(request.url).searchParams.get("namespace")?.trim();
  if (!namespace) {
    return jsonError("Missing namespace.", 400);
  }
  const connection = await getGithubConnection(namespace);
  return NextResponse.json({ connection });
}

export async function DELETE(request: Request) {
  const namespace = new URL(request.url).searchParams.get("namespace")?.trim();
  if (!namespace) {
    return jsonError("Missing namespace.", 400);
  }
  await revokeGithubConnection(namespace);
  return NextResponse.json({ connection: null });
}
