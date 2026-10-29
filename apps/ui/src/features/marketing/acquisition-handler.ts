import type { authorizePersonalResourceRequest } from "@/lib/personal-resource-http";
import type { syncAccountAcquisition } from "./acquisition-service";

export function createAcquisitionSyncHandler(dependencies: {
  authorize: typeof authorizePersonalResourceRequest;
  sync: typeof syncAccountAcquisition;
}) {
  return async function POST(request: Request): Promise<Response> {
    const result = await dependencies.authorize(request, {});
    if (!result.ok) {
      return result.response;
    }
    try {
      const status = await dependencies.sync(
        result.authorization.actorBinding.userUid
      );
      return Response.json(
        { status },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch {
      console.warn(
        "[marketing-acquisition] account attribution sync unavailable"
      );
      return Response.json({ status: "unavailable" }, { status: 503 });
    }
  };
}
