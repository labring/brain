import { createThreadForNamespace } from "@/lib/chat-persistence/service";
import { createThreadBodySchema } from "@/lib/chat-persistence/types";
import { authorizeChatRequestNamespace } from "@/lib/chat-runtime/authorize-chat-request";
import { jsonError } from "@/lib/chat-runtime/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Create an empty assistant thread in the authenticated namespace; returns the new id and refreshed thread list. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (body == null) {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = createThreadBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid body", 400, parsed.error.flatten());
  }

  const authorized = await authorizeChatRequestNamespace(
    req,
    parsed.data.namespace ?? ""
  );
  if (!authorized.ok) {
    return jsonError(authorized.message, authorized.status);
  }

  try {
    // Owner tag: not authenticated, only partitions the view (ADR 0047).
    const result = await createThreadForNamespace(
      authorized.namespace,
      parsed.data.userId ?? ""
    );
    return Response.json(result);
  } catch (error) {
    console.error("[api/chat/thread]", error);
    return jsonError("Could not create thread (DATABASE_URL).", 503);
  }
}
