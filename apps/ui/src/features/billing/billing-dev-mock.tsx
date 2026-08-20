"use client";

import {
  type DevTweaksDriver,
  type DevTweaksGroupDef,
  useDevTweaks,
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
 * Billing's dev-mock face in the dev tweaks panel: one "mock" group with a
 * single scenario select. An override present means fixtures are being served
 * (the MOCK indicator lights); clearing the group turns the mock off. The
 * session cookie stays the single source of truth — the driver below is the
 * only writer on the client, the fixture dispatcher transitions it on the
 * server.
 */

export const BILLING_DEV_MOCK_GROUP_KEY = "billing-mock";

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
 * Cookie persistence for the group, registered on the DevTweaksProvider under
 * the group key. `persist` also drops the whole SWR cache: the scenario
 * shapes every /api/billing/* answer, so billing keys must refetch —
 * everything else is untouched data-wise.
 */
export const billingDevMockDriver: DevTweaksDriver = {
  load: () => {
    const parsed = readCookieState();
    return parsed.kind === "set" && parsed.state.enabled
      ? { scenario: parsed.state.scenario }
      : null;
  },
  persist: (_groupKey, values) => {
    const scenario = values?.scenario;
    const value =
      typeof scenario === "string" && isBillingDevScenario(scenario)
        ? `${formatBillingDevMockCookie({ enabled: true, scenario })}; path=/; samesite=lax`
        : "; path=/; max-age=0; samesite=lax";
    // biome-ignore lint/suspicious/noDocumentCookie: the synchronous write must land before the SWR refetches fire; the async Cookie Store API cannot guarantee that.
    document.cookie = `${BILLING_DEV_MOCK_COOKIE}=${value}`;
    mutate(() => true).catch(() => undefined);
  },
  // The fixture dispatcher rewrites the cookie behind the panel's back (its
  // Set-Cookie scenario transitions); the Cookie Store API pushes those, the
  // focus/interval pair is the fallback. The store dedupes unchanged loads.
  subscribe: (_groupKey, onChange) => {
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

const BILLING_MOCK_GROUP = {
  controls: {
    scenario: {
      label: "Scenario",
      options: BILLING_DEV_SCENARIOS,
      type: "select",
      value: DEFAULT_BILLING_DEV_SCENARIO,
    },
  },
  feature: "billing",
  kind: "mock",
  note: "Serves /api/billing/* from fixtures",
  persistence: BILLING_DEV_MOCK_GROUP_KEY,
  title: "Billing mock",
} as const satisfies DevTweaksGroupDef;

/** Registers the group while any /billing screen is mounted; renders nothing. */
export function BillingDevMockTweaks() {
  useDevTweaks(BILLING_DEV_MOCK_GROUP_KEY, BILLING_MOCK_GROUP);
  return null;
}
