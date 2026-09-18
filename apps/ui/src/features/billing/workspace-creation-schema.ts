import { z } from "zod";

import { workspaceNameSchema } from "@/features/workspace/workspace-write-schema";

/**
 * The request and response shapes of Workspace Creation's two routes (spec
 * §G.3, §G.7). Client-safe: the creation dialog builds its requests from
 * these, the route handlers validate bodies with them, and the dev-mock
 * fixtures answer in them. The payment fields mirror the subscription pay
 * route's paid-change branch; `operator` and `payApp` are the server's to
 * add, never the client's to choose.
 */

/**
 * The first payment's terms. Brain's creation always goes to Stripe
 * Checkout (spec §G.4): a balance payment would settle without a redirect,
 * and the routes read "no redirect" as a failed payment, so the schema
 * admits no other method.
 */
export const workspacePaymentTermsSchema = z.object({
  cardId: z.string().trim().min(1).optional(),
  payMethod: z.literal("stripe"),
  period: z.enum(["1m", "1y"]),
  planName: z.string().trim().min(1),
  promotionCode: z.string().trim().min(1).optional(),
  regionDomain: z.string().trim().min(1),
});

export type WorkspacePaymentTerms = z.infer<typeof workspacePaymentTermsSchema>;

/** `POST /api/billing/workspace-create`: name the Workspace and its first plan. */
export const workspaceCreationRequestSchema =
  workspacePaymentTermsSchema.extend({ name: workspaceNameSchema });

export type WorkspaceCreationRequest = z.infer<
  typeof workspaceCreationRequestSchema
>;

/** `POST /api/billing/workspace-create/retry-payment`: Step 2 again for a created Workspace. */
export const workspaceCreationRetryRequestSchema =
  workspacePaymentTermsSchema.extend({
    workspaceId: z.string().trim().min(1),
  });

export type WorkspaceCreationRetryRequest = z.infer<
  typeof workspaceCreationRetryRequestSchema
>;

export const createdWorkspaceSchema = z.object({
  /** The Kubernetes namespace name, `ns-…` — what account-service calls `workspace`. */
  id: z.string().min(1),
  name: z.string(),
  uid: z.string().min(1),
});

export type CreatedWorkspace = z.infer<typeof createdWorkspaceSchema>;

/**
 * Step 2's outcome. `started` carries the Stripe Checkout URL the page
 * hands the top window; `failed` means the Workspace exists without a
 * subscription and the page offers to retry.
 */
export const workspaceCreationPaymentSchema = z.discriminatedUnion("status", [
  z.object({
    invoiceId: z.string().nullable(),
    payId: z.string().nullable(),
    redirectUrl: z.string().min(1),
    status: z.literal("started"),
  }),
  z.object({
    error: z.string(),
    status: z.literal("failed"),
  }),
  z.object({
    invoiceId: z.string().nullable(),
    payId: z.string().nullable(),
    /**
     * The payment settled without a checkout URL — account-service's
     * balance-style path, which the terms rule out but must still be read
     * as paid, never as a failed payment the page would offer to retry.
     */
    status: z.literal("settled"),
  }),
]);

export type WorkspaceCreationPayment = z.infer<
  typeof workspaceCreationPaymentSchema
>;

export const workspaceCreationResponseSchema = z.object({
  payment: workspaceCreationPaymentSchema,
  workspace: createdWorkspaceSchema,
});

export type WorkspaceCreationResponse = z.infer<
  typeof workspaceCreationResponseSchema
>;

export const workspaceCreationRetryResponseSchema = z.object({
  payment: workspaceCreationPaymentSchema,
});

export type WorkspaceCreationRetryResponse = z.infer<
  typeof workspaceCreationRetryResponseSchema
>;

/** The one creation failure the page keys on: Desktop's 409 for a taken name. */
export const WORKSPACE_NAME_CONFLICT_CODE = "workspace_name_conflict";

export const WORKSPACE_NAME_CONFLICT_MESSAGE =
  "A Workspace with this name already exists.";
