"use client";

import {
  type MarketingAttributionSnapshot,
  type MarketingTouch,
  marketingTouchSchema,
} from "./types";

const ATTRIBUTION_STORAGE_KEY = "sealos_attr_v2";
const ATTRIBUTION_URL_PARAM = "sea_attr";
const GOOGLE_CLICK_ID_TYPES = ["gclid", "gbraid", "wbraid"] as const;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodeAttributionState(value: string): Record<string, unknown> | null {
  try {
    let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) {
      normalized += "=";
    }
    const decoded = Uint8Array.from(window.atob(normalized), (character) =>
      character.charCodeAt(0)
    );
    return recordValue(JSON.parse(new TextDecoder().decode(decoded)));
  } catch {
    return null;
  }
}

function storedAttributionState(): Record<string, unknown> | null {
  try {
    return recordValue(
      JSON.parse(window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY) ?? "null")
    );
  } catch {
    return null;
  }
}

function redactTouchRecord(value: unknown): unknown {
  const touch = recordValue(value);
  return touch ? { ...touch, click_id_value: "" } : value;
}

function consentSafeState(
  state: Record<string, unknown>
): Record<string, unknown> {
  if (state.ad_user_data_consent === true) {
    return state;
  }
  return {
    ...state,
    first_touch: redactTouchRecord(state.first_touch),
    gbraid: null,
    gclid: null,
    last_qualified_touch: redactTouchRecord(state.last_qualified_touch),
    last_touch: redactTouchRecord(state.last_touch),
    wbraid: null,
  };
}

function normalizedTouch(value: unknown): MarketingTouch | null {
  const record = recordValue(value);
  if (record == null) {
    return null;
  }
  const parsed = marketingTouchSchema.safeParse({
    campaign: record.campaign ?? "",
    channel: record.channel ?? "",
    click_id_type: GOOGLE_CLICK_ID_TYPES.includes(
      record.click_id_type as (typeof GOOGLE_CLICK_ID_TYPES)[number]
    )
      ? record.click_id_type
      : "",
    click_id_value: record.click_id_value ?? "",
    content: record.content ?? "",
    landing_hostname: record.landing_hostname ?? "",
    landing_path: record.landing_path ?? "",
    medium: record.medium ?? "",
    source: record.source ?? "",
    term: record.term ?? "",
    ts: record.ts,
  });
  return parsed.success ? parsed.data : null;
}

function clickIds(
  touches: readonly (MarketingTouch | null)[]
): Pick<MarketingAttributionSnapshot, "gbraid" | "gclid" | "wbraid"> {
  const result: Pick<
    MarketingAttributionSnapshot,
    "gbraid" | "gclid" | "wbraid"
  > = { gbraid: null, gclid: null, wbraid: null };
  for (const touch of touches) {
    if (
      touch?.click_id_value &&
      GOOGLE_CLICK_ID_TYPES.includes(
        touch.click_id_type as (typeof GOOGLE_CLICK_ID_TYPES)[number]
      )
    ) {
      result[touch.click_id_type as keyof typeof result] = touch.click_id_value;
      return result;
    }
  }
  return result;
}

export function readMarketingAttribution(): MarketingAttributionSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }
  const inboundValue = new URL(window.location.href).searchParams.get(
    ATTRIBUTION_URL_PARAM
  );
  const inbound = inboundValue ? decodeAttributionState(inboundValue) : null;
  const stored = storedAttributionState();
  const rawState = inbound?.version === 2 ? inbound : stored;
  if (rawState?.version !== 2) {
    return null;
  }
  const state = consentSafeState(rawState);
  window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(state));
  const firstTouch = normalizedTouch(state.first_touch);
  const lastQualifiedTouch = normalizedTouch(state.last_qualified_touch);
  const lastTouch = normalizedTouch(state.last_touch);
  const ids = clickIds([lastQualifiedTouch, lastTouch, firstTouch]);
  const adUserDataConsent = state.ad_user_data_consent === true;
  return {
    ad_user_data_consent: adUserDataConsent,
    first_touch: firstTouch,
    ...ids,
    last_touch: lastTouch ?? lastQualifiedTouch,
    version: 2,
  };
}
