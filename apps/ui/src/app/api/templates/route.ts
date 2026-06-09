import { NextResponse } from "next/server";

import { listTemplateCatalog } from "@/lib/template-provider-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json({
      templates: await listTemplateCatalog({
        language: url.searchParams.get("language") ?? undefined,
      }),
    });
  } catch (error) {
    console.error("[templates] list failed", error);
    return jsonError("Could not load template catalog.", 503);
  }
}
