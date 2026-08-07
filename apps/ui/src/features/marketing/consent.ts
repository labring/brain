import { jwtVerify } from "jose";

import {
  MARKETING_CONSENT_STATES,
  type MarketingAttributionSnapshot,
  type MarketingConsentState,
  type MarketingTouch,
  marketingAttributionSnapshotSchema,
  resolveMarketingConsentState,
} from "./types";

const CONSENT_TOKEN_ISSUER = "sealos-desktop";
const CONSENT_TOKEN_AUDIENCE = "brain-marketing-attribution";

interface VerifiedConsentToken {
  ad_personalization: MarketingConsentState;
  ad_user_data_consent: MarketingConsentState;
  issued_at: string;
  issuer: string;
  jti: string;
  region: string;
  source: "desktop_oauth";
  subject_id: string;
}

export interface NormalizedMarketingAttribution {
  ad_personalization: MarketingConsentState;
  ad_user_data_consent: MarketingConsentState;
  click_id_candidates: MarketingTouch[];
  consent_provenance: {
    issuer: string;
    issued_at: string;
    jti: string;
    region: string;
    source: "desktop_oauth";
    subject_id: string;
  } | null;
  first_touch: MarketingTouch | null;
  gbraid: string | null;
  gclid: string | null;
  last_touch: MarketingTouch | null;
  version: 3;
  wbraid: string | null;
}

function consentSigningKey(): Uint8Array | null {
  const value = process.env.MARKETING_CONSENT_SIGNING_KEY?.trim();
  return value ? new TextEncoder().encode(value) : null;
}

function consentIssuedAt(iat: unknown): string | null {
  if (typeof iat !== "number" || !Number.isFinite(iat)) {
    return null;
  }
  const value = new Date(iat * 1000);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export async function verifyMarketingConsentToken(
  token: string | undefined,
  expectedSubject: string | null | undefined
): Promise<VerifiedConsentToken | null> {
  const key = consentSigningKey();
  if (key == null || !token || !expectedSubject) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      audience: CONSENT_TOKEN_AUDIENCE,
      maxTokenAge: "15m",
      issuer: CONSENT_TOKEN_ISSUER,
    });
    const issuedAt = consentIssuedAt(payload.iat);
    if (
      payload.sub !== expectedSubject ||
      typeof payload.jti !== "string" ||
      issuedAt == null ||
      payload.consent_source !== "desktop_oauth" ||
      typeof payload.region !== "string" ||
      payload.region.trim() === "" ||
      typeof payload.ad_user_data_consent !== "string" ||
      typeof payload.ad_personalization !== "string" ||
      !MARKETING_CONSENT_STATES.includes(
        payload.ad_user_data_consent as MarketingConsentState
      ) ||
      !MARKETING_CONSENT_STATES.includes(
        payload.ad_personalization as MarketingConsentState
      )
    ) {
      return null;
    }

    const adUserDataConsent = resolveMarketingConsentState(
      payload.ad_user_data_consent as
        | boolean
        | "granted"
        | "denied"
        | "unspecified"
    );
    const adPersonalization = resolveMarketingConsentState(
      payload.ad_personalization as
        | boolean
        | "granted"
        | "denied"
        | "unspecified"
    );
    return {
      ad_personalization: adPersonalization,
      ad_user_data_consent: adUserDataConsent,
      issued_at: issuedAt,
      issuer: CONSENT_TOKEN_ISSUER,
      jti: payload.jti,
      region: payload.region,
      source: "desktop_oauth",
      subject_id: expectedSubject,
    };
  } catch {
    return null;
  }
}

function redactTouch(touch: MarketingTouch | null): MarketingTouch | null {
  return touch == null ? null : { ...touch, click_id_value: "" };
}

function redactCandidates(
  candidates: readonly MarketingTouch[]
): MarketingTouch[] {
  return candidates.map((touch) => redactTouch(touch) as MarketingTouch);
}

function nullableClickId(
  value: string | null,
  consentState: MarketingConsentState
): string | null {
  return consentState === "granted" ? value : null;
}

/**
 * Converts a browser or producer payload into the only attribution shape that
 * may reach deployment storage. A verified Desktop OAuth token supplies the
 * consent state and provenance; legacy or unsigned payloads stay observable
 * while their click identifiers are removed.
 */
export async function normalizeMarketingAttribution(
  input: MarketingAttributionSnapshot,
  expectedSubject: string | null | undefined
): Promise<NormalizedMarketingAttribution | undefined> {
  const parsed = marketingAttributionSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return undefined;
  }

  const supplied = parsed.data;
  const verified = await verifyMarketingConsentToken(
    supplied.consent_token,
    expectedSubject
  );
  const consentState = verified?.ad_user_data_consent ?? "unspecified";
  const personalizationState = verified?.ad_personalization ?? "unspecified";
  const consentGranted = consentState === "granted";
  const candidates = consentGranted
    ? supplied.click_id_candidates
    : redactCandidates(supplied.click_id_candidates);

  return {
    ad_personalization: personalizationState,
    ad_user_data_consent: consentState,
    click_id_candidates: candidates,
    consent_provenance:
      verified == null
        ? null
        : {
            issuer: verified.issuer,
            issued_at: verified.issued_at,
            jti: verified.jti,
            region: verified.region,
            source: verified.source,
            subject_id: verified.subject_id,
          },
    first_touch: consentGranted
      ? supplied.first_touch
      : redactTouch(supplied.first_touch),
    gbraid: nullableClickId(supplied.gbraid, consentState),
    gclid: nullableClickId(supplied.gclid, consentState),
    last_touch: consentGranted
      ? supplied.last_touch
      : redactTouch(supplied.last_touch),
    version: 3,
    wbraid: nullableClickId(supplied.wbraid, consentState),
  };
}
