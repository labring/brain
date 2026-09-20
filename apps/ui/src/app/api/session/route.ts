import { withSessionDevMock } from "@/features/session/server/create-session-route";
import { createSessionHandler } from "@/features/session/server/session-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withSessionDevMock(createSessionHandler());
