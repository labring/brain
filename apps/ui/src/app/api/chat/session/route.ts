import { bootstrapAssistantSession } from "@/lib/chat-persistence/service";
import { authorizeChatRequestNamespace } from "@/lib/chat-runtime/authorize-chat-request";
import { jsonError } from "@/lib/chat-runtime/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Latest thread + messages + thread list for the authenticated namespace. Creates one when none exists. */
export async function GET(req: Request) {
  const namespaceRaw = new URL(req.url).searchParams.get("namespace") ?? "";
  const authorized = await authorizeChatRequestNamespace(req, namespaceRaw);
  if (!authorized.ok) {
    return jsonError(authorized.message, authorized.status);
  }
  try {
    return Response.json(await bootstrapAssistantSession(authorized.namespace));
  } catch (error) {
    console.error("[api/chat/session]", error);
    return jsonError(
      "Could not load assistant session (database / DATABASE_URL).",
      503
    );
  }
}
