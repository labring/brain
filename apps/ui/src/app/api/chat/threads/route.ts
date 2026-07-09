import { listThreadsForNamespace } from "@/lib/chat-persistence/service";
import { authorizeChatRequestNamespace } from "@/lib/chat-runtime/authorize-chat-request";
import { jsonError } from "@/lib/chat-runtime/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Threads in the authenticated namespace, newest-first. */
export async function GET(req: Request) {
  const namespaceRaw = new URL(req.url).searchParams.get("namespace") ?? "";
  const authorized = await authorizeChatRequestNamespace(req, namespaceRaw);
  if (!authorized.ok) {
    return jsonError(authorized.message, authorized.status);
  }
  try {
    const threads = await listThreadsForNamespace(authorized.namespace);
    return Response.json({ threads });
  } catch (error) {
    console.error("[api/chat/threads]", error);
    return jsonError(
      "Assistant chat persistence is unavailable (check DATABASE_URL).",
      503
    );
  }
}
