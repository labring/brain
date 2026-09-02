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
 * Billing's Dev Mock: registered with the dev tweaks panel through the
 * app-global mock registry (`features/dev-mock/dev-mocks.tsx`), so the panel
 * shows it wherever the user is — the session cookie it controls is
 * path-global. The cookie stays the single source of truth: the source below
 * is the only writer on the client, the fixture dispatcher transitions it on
 * the server.
 */

export const BILLING_DEV_MOCK_KEY = "billing-mock";

const billingDevMockSource = createDevMockCookieSource(billingDevMockCookie);

/** Registers the mock with the app-global registry; renders nothing. */
export function BillingDevMockTweaks() {
  useDevTweaksMock(BILLING_DEV_MOCK_KEY, {
    defaultScenario: DEFAULT_BILLING_DEV_SCENARIO,
    note: "Serves /api/billing/* and the Notification Center from fixtures",
    // A served-state change (toggle, enabled scenario switch, or a server
    // Set-Cookie transition) revalidates only the SWR keys the mock owns
    // (see `dev-mock-swr-keys.ts`) — nothing else on the page is touched.
    revalidate: () => {
      mutate(isBillingDevMockSwrKey).catch(() => undefined);
    },
    scenarios: BILLING_DEV_SCENARIOS,
    source: billingDevMockSource,
    title: "Billing mock",
  });
  return null;
}
