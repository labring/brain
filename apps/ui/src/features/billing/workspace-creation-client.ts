import {
  type BillingCredentials,
  type BillingFetch,
  BillingRequestError,
  createBillingJsonRequester,
} from "@/features/billing/billing-data-client";

import { BILLING_ROUTES } from "./server/billing-route-table";
import {
  WORKSPACE_NAME_CONFLICT_MESSAGE,
  type WorkspaceCreationPayment,
  type WorkspaceCreationResponse,
  workspaceCreationResponseSchema,
  workspaceCreationRetryResponseSchema,
} from "./workspace-creation-schema";

/**
 * The page's side of Workspace Creation (spec §G): the two routes as
 * functions, credentials attached the way every billing fetcher does. The
 * server's 409 becomes the one error the dialog tells apart — the name is
 * taken and the field says so inline; every other failure surfaces its
 * message. Brain always pays by Stripe for a month: the dialog offers no
 * other terms.
 */

export class WorkspaceNameConflictError extends Error {
  constructor() {
    super(WORKSPACE_NAME_CONFLICT_MESSAGE);
    this.name = "WorkspaceNameConflictError";
  }
}

interface WorkspaceCreationDependencies {
  fetch?: BillingFetch;
}

interface WorkspaceCreationInput extends BillingCredentials {
  name: string;
  planName: string;
  regionDomain: string;
}

const PAYMENT_TERMS = { payMethod: "stripe", period: "1m" } as const;

function routeErrorMessage(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload != null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim() !== ""
  ) {
    return payload.error.trim();
  }
  return null;
}

function creationRequester(
  credentials: BillingCredentials,
  fallbackErrorMessage: string,
  dependencies: WorkspaceCreationDependencies
) {
  return createBillingJsonRequester({
    credentials,
    fallbackErrorMessage,
    fetch: dependencies.fetch ?? globalThis.fetch,
  });
}

/** Both steps: the Workspace, then its first payment. */
export async function createWorkspaceWithSubscription(
  input: WorkspaceCreationInput,
  dependencies: WorkspaceCreationDependencies = {}
): Promise<WorkspaceCreationResponse> {
  const requestBillingJson = creationRequester(
    input,
    "The Workspace could not be created.",
    dependencies
  );
  let payload: unknown;
  try {
    payload = await requestBillingJson(BILLING_ROUTES.workspaceCreate.apiPath, {
      name: input.name,
      ...PAYMENT_TERMS,
      planName: input.planName,
      regionDomain: input.regionDomain,
    });
  } catch (error) {
    if (error instanceof BillingRequestError && error.status === 409) {
      throw new WorkspaceNameConflictError();
    }
    // A 403 here is Desktop refusing the creation (a Workspace limit), not
    // the billing-permission verdict the shared requester words every 403
    // as; the route's own message is the truthful one.
    if (error instanceof BillingRequestError && error.status === 403) {
      throw new BillingRequestError(
        routeErrorMessage(error.payload) ?? error.message,
        error.status,
        error.payload
      );
    }
    throw error;
  }
  return workspaceCreationResponseSchema.parse(payload);
}

/** Step 2 again, for a Workspace that exists without its subscription. */
export async function retryWorkspaceCreationPayment(
  input: BillingCredentials & {
    planName: string;
    regionDomain: string;
    workspaceId: string;
  },
  dependencies: WorkspaceCreationDependencies = {}
): Promise<WorkspaceCreationPayment> {
  const requestBillingJson = creationRequester(
    input,
    "The subscription payment could not be started.",
    dependencies
  );
  const payload = await requestBillingJson(
    BILLING_ROUTES.workspaceCreateRetryPayment.apiPath,
    {
      ...PAYMENT_TERMS,
      planName: input.planName,
      regionDomain: input.regionDomain,
      workspaceId: input.workspaceId,
    }
  );
  return workspaceCreationRetryResponseSchema.parse(payload).payment;
}
