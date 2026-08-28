"use client";

import { useDevTweaksMock } from "@workspace/dev-tweaks";
import { mutate } from "swr";

import { createDevMockCookieSource } from "@/features/dev-mock/source";

import {
  BILLING_DEV_SCENARIOS,
  billingDevMockCookie,
  DEFAULT_BILLING_DEV_SCENARIO,
} from "./dev-mock-cookie";
import { isBillingDevMockSwrKey } from "./dev-mock-swr-keys";

/**
 * Billing's Dev Mock: registered with the dev tweaks panel while any
 * /billing screen or the App Sidebar's Notification Center is mounted. The session cookie stays the single source of
 * truth — the source below is the only writer on the client, the fixture
 * dispatcher transitions it on the server.
 */

export const BILLING_DEV_MOCK_KEY = "billing-mock";

/**
 * Cookie-backed mock source; a toggle revalidates the SWR keys the mock
 * owns (see `dev-mock-swr-keys.ts`) — nothing else on the page is touched.
 */
const billingDevMockSource = createDevMockCookieSource(billingDevMockCookie, {
  revalidate: () => {
    mutate(isBillingDevMockSwrKey).catch(() => undefined);
  },
});

/** Registers the mock while any /billing screen is mounted; renders nothing. */
export function BillingDevMockTweaks() {
  useDevTweaksMock(BILLING_DEV_MOCK_KEY, {
    defaultScenario: DEFAULT_BILLING_DEV_SCENARIO,
    note: "Serves /api/billing/* and the Notification Center from fixtures",
    scenarios: BILLING_DEV_SCENARIOS,
    source: billingDevMockSource,
    title: "Billing mock",
  });
  return null;
}
