"use client";

import {
  type MarketingAttributionSnapshot,
  type MarketingTouch,
  marketingTouchSchema,
  resolveMarketingConsentState,
} from "./types";

const ATTRIBUTION_STORAGE_KEYS = ["sealos_attr_v3", "sealos_attr_v2"] as const;
const CONSENT_TOKEN_STORAGE_KEY = "sealos_marketing_consent_token";
const ATTRIBUTION_URL_PARAM = "sea_attr";
const CONSENT_TOKEN_URL_PARAM = "consent_token";
const ATTRIBUTION_RAW_STORAGE_KEY = "sealos_marketing_attribution_raw_v1";
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
    for (const key of ATTRIBUTION_STORAGE_KEYS) {
      const value = recordValue(
        JSON.parse(window.localStorage.getItem(key) ?? "null")
      );
      if (value != null) {
        return value;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function storedConsentToken(): string | null {
  try {
    const value = window.sessionStorage.getItem(CONSENT_TOKEN_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function storedAttributionRaw(): string | null {
  try {
    const value = window.sessionStorage.getItem(ATTRIBUTION_RAW_STORAGE_KEY);
    return value?.trim() && value.length <= 16384 ? value : null;
  } catch {
    return null;
  }
}

function redactTouchRecord(value: unknown): unknown {
  const touch = recordValue(value);
  return touch ? { ...touch, click_id_value: "" } : value;
}

function consentSafeState(
  state: Record<string, unknown>,
  hasConsentToken: boolean
): Record<string, unknown> {
  const consentState = resolveMarketingConsentState(
    state.ad_user_data_consent as boolean | "granted" | "denied" | "unspecified"
  );
  if (hasConsentToken && consentState === "granted") {
    return state;
  }
  return {
    ...state,
    ad_user_data_consent:
      hasConsentToken && consentState === "denied" ? "denied" : "unspecified",
    first_touch: redactTouchRecord(state.first_touch),
    gbraid: null,
    gclid: null,
    click_id_candidates: Array.isArray(state.click_id_candidates)
      ? state.click_id_candidates.map(redactTouchRecord)
      : [],
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
      const key = touch.click_id_type as keyof typeof result;
      if (result[key] == null) {
        result[key] = touch.click_id_value;
      }
    }
  }
  return result;
}

export function readMarketingAttribution(): MarketingAttributionSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }
  const inboundValue = new URL(window.location.href).searchParams
    .get(ATTRIBUTION_URL_PARAM)
    ?.trim();
  const inbound = inboundValue ? decodeAttributionState(inboundValue) : null;
  const attributionRaw =
    inbound != null && (inbound.version === 2 || inbound.version === 3)
      ? inboundValue
      : storedAttributionRaw();
  const stored = storedAttributionState();
  const params = new URL(window.location.href).searchParams;
  const consentToken =
    params.get(CONSENT_TOKEN_URL_PARAM)?.trim() || storedConsentToken();
  const rawState =
    inbound?.version === 2 || inbound?.version === 3 ? inbound : stored;
  if (rawState?.version !== 2 && rawState?.version !== 3) {
    return null;
  }
  const state = consentSafeState(
    consentToken == null
      ? rawState
      : { ...rawState, consent_token: consentToken },
    consentToken != null
  );
  if (consentToken != null) {
    try {
      window.sessionStorage.setItem(CONSENT_TOKEN_STORAGE_KEY, consentToken);
    } catch {
      // Storage is optional in private browsing contexts.
    }
  }
  if (attributionRaw != null) {
    try {
      window.sessionStorage.setItem(
        ATTRIBUTION_RAW_STORAGE_KEY,
        attributionRaw
      );
    } catch {
      // Storage is optional in private browsing contexts.
    }
  }
  window.localStorage.setItem("sealos_attr_v3", JSON.stringify(state));
  const firstTouch = normalizedTouch(state.first_touch);
  const lastQualifiedTouch = normalizedTouch(state.last_qualified_touch);
  const lastTouch = normalizedTouch(state.last_touch);
  const candidateTouches = Array.isArray(state.click_id_candidates)
    ? state.click_id_candidates
        .map(normalizedTouch)
        .filter((touch): touch is MarketingTouch => touch != null)
    : [];
  const ids = clickIds([
    ...candidateTouches,
    lastQualifiedTouch,
    lastTouch,
    firstTouch,
  ]);
  const adUserDataConsent = consentToken
    ? resolveMarketingConsentState(
        state.ad_user_data_consent as
          | boolean
          | "granted"
          | "denied"
          | "unspecified"
      )
    : "unspecified";
  return {
    ad_personalization: resolveMarketingConsentState(
      state.ad_personalization as boolean | "granted" | "denied" | "unspecified"
    ),
    ad_user_data_consent: adUserDataConsent,
    attribution_raw: attributionRaw ?? undefined,
    click_id_candidates: candidateTouches,
    consent_token: consentToken ?? undefined,
    consent_provenance: null,
    first_touch: firstTouch,
    ...ids,
    last_touch: lastTouch ?? lastQualifiedTouch,
    version: 3,
  };
}
