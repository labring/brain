import { NextResponse } from "next/server";

import { verifyCustomDomainCname } from "@/features/project-canvas/custom-domain-cname";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isRequestBodyRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function requestString(
  body: Record<string, unknown>,
  field: "domain" | "target"
): string {
  const value = body[field];
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!isRequestBodyRecord(body)) {
    return jsonError("Invalid CNAME verification request.", 400);
  }

  try {
    const result = await verifyCustomDomainCname({
      domain: requestString(body, "domain"),
      target: requestString(body, "target"),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch {
    return jsonError("CNAME verification is unavailable.", 503);
  }
}
