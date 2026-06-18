import { API_ROUTES } from "@workspace/api/constants";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  const base = process.env.API_URL?.trim() || "";
  if (!base) {
    return NextResponse.json(
      { error: "API_URL is not configured." },
      { status: 500 }
    );
  }

  const url = new URL(API_ROUTES.k8s.exec, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return NextResponse.json({ webSocketUrl: url.href });
}
