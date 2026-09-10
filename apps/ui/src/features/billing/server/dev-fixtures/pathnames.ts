import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";

/**
 * Dispatch key of the Workspace Owner standing read (ADR-0082). Production
 * code names it too — the server-side standing asks the dev mock under it
 * before reading the namespace — so it lives outside the fixtures module,
 * which must never reach a production bundle.
 */
export const WORKSPACE_OWNER_FIXTURE_PATHNAME =
  BILLING_ROUTES.workspaceOwner.upstreamPathname;
