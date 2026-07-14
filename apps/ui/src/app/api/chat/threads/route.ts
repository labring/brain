import { listThreadsForNamespace } from "@/features/chat/persistence/service";
import { authorizeChatRequestNamespace } from "@/features/chat/runtime/authorize-chat-request";
import { jsonError } from "@/features/chat/runtime/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Threads in the authenticated namespace, newest-first. */
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
    const threads = await listThreadsForNamespace(authorized.namespace, userId);
    return Response.json({ threads });
  } catch (error) {
    console.error("[api/chat/threads]", error);
    return jsonError(
      "Assistant chat persistence is unavailable (check DATABASE_URL).",
      503
    );
  }
}
