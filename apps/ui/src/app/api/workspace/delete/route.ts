import { withWorkspaceDevMock } from "@/features/workspace/server/create-workspace-route";
import { WORKSPACE_ROUTES } from "@/features/workspace/server/workspace-route-table";
import { createWorkspaceDeleteHandler } from "@/features/workspace/server/workspace-write-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withWorkspaceDevMock(
  WORKSPACE_ROUTES.delete,
  createWorkspaceDeleteHandler()
);
