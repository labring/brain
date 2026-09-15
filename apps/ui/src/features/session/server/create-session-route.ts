type SessionRouteHandler = (request: Request) => Promise<Response>;

/**
 * Lets the session dev-mock dispatcher answer `POST /api/session` first in
 * dev and demo builds (same gate as the billing routes: `NEXT_PUBLIC_DEV_TWEAKS=1`
 * marks a demo image). The build-time-guarded dynamic import keeps the
 * fixtures out of real production bundles; by default the mock is off and
 * the real Desktop path runs. The gate is inlined here, as in
 * `withBillingDevMock`, because a shared helper call would not be
 * statically dropped from the bundle.
 */
export function withSessionDevMock(
  handler: SessionRouteHandler
): SessionRouteHandler {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return handler;
  }
  return async (request) => {
    const { sessionDevMockResponse } = await import("./dev-fixtures");
    const mocked = await sessionDevMockResponse(request);
    return mocked ?? handler(request);
  };
}
