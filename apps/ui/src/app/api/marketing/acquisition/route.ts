import { createAcquisitionSyncHandler } from "@/features/marketing/acquisition-handler";
import { syncAccountAcquisition } from "@/features/marketing/acquisition-service";
import { authorizePersonalResourceRequest } from "@/lib/personal-resource-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createAcquisitionSyncHandler({
  authorize: authorizePersonalResourceRequest,
  sync: syncAccountAcquisition,
});
