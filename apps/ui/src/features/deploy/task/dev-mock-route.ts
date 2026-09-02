import "server-only";

import type { DeployTaskDevMockRoute } from "./dev-fixtures";

type RouteContextArgs<C> = C extends undefined
  ? [context?: undefined]
  : [context: C];

type RouteHandler<C> = (
  request: Request,
  ...args: RouteContextArgs<C>
) => Promise<Response>;

/**
 * Lets the Deployment Task Timeline Dev Mock answer first in dev and demo
 * builds (`NEXT_PUBLIC_DEV_TWEAKS=1` marks a demo image); a real production
 * build statically drops the dynamic import, so fixtures never reach
 * production bundles — the same gate as the /api/billing routes.
 */
export function withDeployTaskDevMock<C = undefined>(
  route: DeployTaskDevMockRoute,
  handler: RouteHandler<C>,
  taskIdOf: (...args: RouteContextArgs<C>) => Promise<string | null> = () =>
    Promise.resolve(null)
): RouteHandler<C> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return handler;
  }
  return async (request, ...args) => {
    const { deployTaskDevMockResponse } = await import("./dev-fixtures");
    const mocked = deployTaskDevMockResponse(
      route,
      request,
      await taskIdOf(...args)
    );
    return mocked ?? handler(request, ...args);
  };
}
