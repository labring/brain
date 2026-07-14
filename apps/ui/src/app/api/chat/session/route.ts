import { bootstrapAssistantSession } from "@/features/chat/persistence/service";
import { authorizeChatRequestNamespace } from "@/features/chat/runtime/authorize-chat-request";
import { jsonError } from "@/features/chat/runtime/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Latest thread + messages + thread list for the authenticated namespace. Creates one when none exists. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const namespaceRaw = url.searchParams.get("namespace") ?? "";
  // Owner tag: not authenticated, only partitions the view (ADR 0047).
  const userId = url.searchParams.get("userId") ?? "";
  const authorized = await authorizeChatRequestNamespace(req, namespaceRaw);
  if (!authorized.ok) {
    return jsonError(authorized.message, authorized.status);
  }
  try {
    return Response.json(
      await bootstrapAssistantSession(authorized.namespace, userId)
    );
  } catch (error) {
    console.error("[api/chat/session]", error);
    return jsonError(
      "Could not load assistant session (database / DATABASE_URL).",
      503
    );
  }
}
