import { z } from "zod";

import {
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";

/**
 * Whether the account ever recorded a paid top-up — the fact that ends the
 * Notification Center's gift-only filter forever (design spec §6 D1). Read
 * from the account's payment history over its whole life: history only
 * grows, so one top-up stays true by construction. Rows are read loosely —
 * only the type and status matter here.
 */

const paymentsResponseSchema = z.object({
  payments: z
    .array(
      z.object({
        Status: z.string().optional(),
        Type: z.string().default(""),
      })
    )
    .nullish()
    .transform((value) => value ?? []),
});

/** Payment history begins after the platform did; anything earlier is empty. */
const ALL_TIME_START = "2020-01-01T00:00:00.000Z";

export function isPaidTopUpPayment(payment: {
  Status?: string;
  Type: string;
}): boolean {
  return (
    payment.Type.toUpperCase().includes("RECHARGE") &&
    (payment.Status == null || payment.Status.toUpperCase() === "PAID")
  );
}

export async function loadHasToppedUp(
  credentials: { appToken: string; kubeconfig: string },
  fetch: BillingFetch = globalThis.fetch,
  now: () => Date = () => new Date()
): Promise<boolean> {
  const requestBillingJson = createBillingJsonRequester({
    credentials,
    fallbackErrorMessage: "Could not load payment history.",
    fetch,
  });
  const payload = await requestBillingJson("/api/billing/payments", {
    endTime: now().toISOString(),
    startTime: ALL_TIME_START,
  });
  const parsed = paymentsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Payment history response is invalid.");
  }
  return parsed.data.payments.some(isPaidTopUpPayment);
}
