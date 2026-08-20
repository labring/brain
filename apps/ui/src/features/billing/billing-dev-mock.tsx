"use client";

import {
  type DevTweaksMockSource,
  useDevTweaksMock,
} from "@workspace/dev-tweaks";
import { mutate } from "swr";

import {
  BILLING_DEV_MOCK_COOKIE,
  BILLING_DEV_SCENARIOS,
  DEFAULT_BILLING_DEV_SCENARIO,
  formatBillingDevMockCookie,
  isBillingDevScenario,
  parseBillingDevMockCookie,
} from "./dev-mock-cookie";

/**
 * Billing's Dev Mock: registered with the dev tweaks panel while any
 * /billing screen is mounted. The session cookie stays the single source of
 * truth — the source below is the only writer on the client, the fixture
 * dispatcher transitions it on the server.
 */

export const BILLING_DEV_MOCK_KEY = "billing-mock";

function readCookieState() {
  const pair = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${BILLING_DEV_MOCK_COOKIE}=`));
  return parseBillingDevMockCookie(
    pair?.slice(BILLING_DEV_MOCK_COOKIE.length + 1)
  );
}

/**
 * Cookie-backed mock source. `set` also drops the whole SWR cache: the
 * scenario shapes every /api/billing/* answer, so billing keys must refetch —
 * everything else is untouched data-wise.
 */
const billingDevMockSource: DevTweaksMockSource = {
  load: () => {
    const parsed = readCookieState();
    return parsed.kind === "set" ? parsed.state : null;
  },
  set: (state) => {
    const scenario = isBillingDevScenario(state.scenario)
      ? state.scenario
      : DEFAULT_BILLING_DEV_SCENARIO;
    const value = formatBillingDevMockCookie({
      enabled: state.enabled,
      scenario,
    });
    // biome-ignore lint/suspicious/noDocumentCookie: the synchronous write must land before the SWR refetches fire; the async Cookie Store API cannot guarantee that.
    document.cookie = `${BILLING_DEV_MOCK_COOKIE}=${value}; path=/; samesite=lax`;
    mutate(() => true).catch(() => undefined);
  },
  // The fixture dispatcher rewrites the cookie behind the panel's back (its
  // Set-Cookie scenario transitions); the Cookie Store API pushes those, the
  // focus/interval pair is the fallback. The mock store dedupes unchanged
  // loads.
  watch: (onChange) => {
    const cookieStore = (window as { cookieStore?: EventTarget }).cookieStore;
    cookieStore?.addEventListener("change", onChange);
    window.addEventListener("focus", onChange);
    const watchTimer =
      cookieStore == null ? window.setInterval(onChange, 3000) : undefined;
    return () => {
      cookieStore?.removeEventListener("change", onChange);
      window.removeEventListener("focus", onChange);
      if (watchTimer != null) {
        window.clearInterval(watchTimer);
      }
    };
  },
};

/** Registers the mock while any /billing screen is mounted; renders nothing. */
export function BillingDevMockTweaks() {
  useDevTweaksMock(BILLING_DEV_MOCK_KEY, {
    defaultScenario: DEFAULT_BILLING_DEV_SCENARIO,
    note: "Serves /api/billing/* from fixtures",
    scenarios: BILLING_DEV_SCENARIOS,
    source: billingDevMockSource,
    title: "Billing mock",
  });
  return null;
}
