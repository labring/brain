import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";
import { withBillingDevMock } from "@/features/billing/server/create-billing-route";
import { readWorkspaceOwnerStanding } from "@/features/billing/server/workspace-owner-reader";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";
import { createWorkspaceOwnerHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withBillingDevMock(
  BILLING_ROUTES.workspaceOwner,
  createWorkspaceOwnerHandler({
    authorizeWorkspaceActor,
    readWorkspaceOwnerStanding,
  })
);
