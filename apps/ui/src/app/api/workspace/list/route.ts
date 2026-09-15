import { withWorkspaceDevMock } from "@/features/workspace/server/create-workspace-route";
import { createWorkspaceListHandler } from "@/features/workspace/server/workspace-list-handler";
import { WORKSPACE_ROUTES } from "@/features/workspace/server/workspace-route-table";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withWorkspaceDevMock(
  WORKSPACE_ROUTES.list,
  createWorkspaceListHandler()
);
