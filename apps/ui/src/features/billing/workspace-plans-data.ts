import { z } from "zod";

import {
  type BillingCredentials,
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";

const workspacePlansResponseSchema = z.object({
  plans: z.record(z.string(), z.string().nullable()),
});

/** Plan name per Workspace namespace id; null = no subscription (PAYG). */
export type WorkspacePlans = Record<string, string | null>;

/**
 * The Workspace Switcher's plan badges (spec §C.5): one read of
 * `GET /api/billing/workspace-plans` for the session's Workspace list.
 * The route answers null per Workspace it cannot read; a failed route
 * rejects, and the Switcher then shows no badge on any row.
 */
export async function loadWorkspacePlans(
  credentials: BillingCredentials,
  workspaceIds: readonly string[],
  fetch: BillingFetch = globalThis.fetch
): Promise<WorkspacePlans> {
  const requestBillingJson = createBillingJsonRequester({
    credentials,
    fallbackErrorMessage: "Could not load the workspace plans.",
    fetch,
  });
  const query = new URLSearchParams();
  for (const id of workspaceIds) {
    query.append("workspace", id);
  }
  return workspacePlansResponseSchema.parse(
    await requestBillingJson(`/api/billing/workspace-plans?${query}`)
  ).plans;
}
