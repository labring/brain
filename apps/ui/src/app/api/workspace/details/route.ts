import { withWorkspaceDevMock } from "@/features/workspace/server/create-workspace-route";
import { createWorkspaceDetailsHandler } from "@/features/workspace/server/workspace-details-handler";
import { WORKSPACE_ROUTES } from "@/features/workspace/server/workspace-route-table";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withWorkspaceDevMock(
  WORKSPACE_ROUTES.details,
  createWorkspaceDetailsHandler()
);
