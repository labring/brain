import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { recordMarketingLifecycleEvent } from "@/features/marketing/service";
import { marketingLifecycleEventInputSchema } from "@/features/marketing/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const BEARER_PREFIX_RE = /^Bearer\s+/i;

function authorized(request: Request): boolean {
  const expected = process.env.MARKETING_EVENTS_INGEST_SECRET?.trim();
  const supplied = request.headers
    .get("authorization")
    ?.replace(BEARER_PREFIX_RE, "")
    .trim();
  if (expected == null || expected.length === 0) {
    return false;
  }
  if (supplied == null || supplied.length === 0) {
    return false;
  }
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = marketingLifecycleEventInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid lifecycle event", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const status = await recordMarketingLifecycleEvent(parsed.data);
  return NextResponse.json(
    { event_id: parsed.data.event_id, status },
    { status: status === "created" ? 201 : 200 }
  );
}
