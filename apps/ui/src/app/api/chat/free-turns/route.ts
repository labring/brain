import { assistantConversationRouteHandlers } from "@/features/chat/runtime/conversation-route-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The billing Dev Mock answers this Brain-owned route too (dev/demo builds
 * only): the sidebar's AI-usage row and the Plan view's allowance card read
 * their Free Chat Turns here, so a Mock Scenario must shape them alongside
 * the `/api/billing/*` proxies. The dynamic-import gate stays inlined so
 * fixtures never enter production bundles (dev-mock/server/resolve.ts).
 */
async function freeTurnsDevMockResponse(
  request: Request
): Promise<Response | null> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return null;
  }
  const { freeChatTurnsFixture, resolveBillingDevMock } = await import(
    "@/features/billing/server/dev-fixtures"
  );
  const resolution = resolveBillingDevMock(request);
  if (resolution.kind === "off") {
    return null;
  }
  if (resolution.kind === "invalid") {
    return resolution.response;
  }
  return Response.json(freeChatTurnsFixture(resolution.scenario));
}

export const GET = async (request: Request): Promise<Response> => {
  const mocked = await freeTurnsDevMockResponse(request);
  return mocked ?? assistantConversationRouteHandlers.freeTurns(request);
};
