import "server-only";

import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";
import { withBillingDevMock } from "@/features/billing/server/create-billing-route";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";

import { getCancellationSurveyDb } from "./db";
import { createCancellationSurveyHandler } from "./http-handler";
import { createCancellationSurveyStore } from "./store";

const store = createCancellationSurveyStore(getCancellationSurveyDb);

/**
 * Production wiring for the Cancellation Survey write (ADR-0072). The
 * dev-mock dispatcher answers first in dev and demo builds so the survey
 * succeeds offline alongside the mocked cancel.
 */
export const cancellationSurveyRouteHandler = withBillingDevMock(
  BILLING_ROUTES.subscriptionCancellationSurvey,
  createCancellationSurveyHandler({
    authorizeWorkspaceActor,
    record: store.record,
  })
);
