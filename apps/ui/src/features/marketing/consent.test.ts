import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { SignJWT } from "jose";

import { normalizeMarketingAttribution } from "./consent";
import type { MarketingAttributionSnapshot } from "./types";

const SIGNING_KEY = "brain-test-marketing-consent-signing-key";
const previousSigningKey = process.env.MARKETING_CONSENT_SIGNING_KEY;

const touch = {
  campaign: "activation-search",
  channel: "paid_search",
  click_id_type: "gclid" as const,
  click_id_value: "gclid-test",
  content: "repo-to-url",
  landing_hostname: "sealos.io",
  landing_path: "/",
  medium: "paid",
  source: "google",
  term: "deploy repo",
  ts: "2026-08-06T08:00:00.000Z",
};

function snapshot(token?: string): MarketingAttributionSnapshot {
  return {
    ad_personalization: "granted",
    ad_user_data_consent: "granted",
    click_id_candidates: [touch],
    consent_provenance: null,
    ...(token == null ? {} : { consent_token: token }),
    first_touch: touch,
    gbraid: "gbraid-test",
    gclid: "gclid-test",
    last_touch: touch,
    version: 3,
    wbraid: "wbraid-test",
  };
}

async function consentToken(subject: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    ad_personalization: "granted",
    ad_user_data_consent: "granted",
    consent_source: "desktop_oauth",
    region: "global",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("sealos-desktop")
    .setAudience("brain-marketing-attribution")
    .setSubject(subject)
    .setJti("consent-test-jti")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 600)
    .sign(new TextEncoder().encode(SIGNING_KEY));
}

afterEach(() => {
  if (previousSigningKey == null) {
    delete process.env.MARKETING_CONSENT_SIGNING_KEY;
  } else {
    process.env.MARKETING_CONSENT_SIGNING_KEY = previousSigningKey;
  }
});

test("verified Desktop OAuth consent preserves every Google click ID", async () => {
  process.env.MARKETING_CONSENT_SIGNING_KEY = SIGNING_KEY;
  const token = await consentToken("user-1");

  const result = await normalizeMarketingAttribution(snapshot(token), "user-1");

  assert.equal(result?.ad_user_data_consent, "granted");
  assert.equal(result?.ad_personalization, "granted");
  assert.equal(result?.gclid, "gclid-test");
  assert.equal(result?.gbraid, "gbraid-test");
  assert.equal(result?.wbraid, "wbraid-test");
  assert.equal(result?.consent_provenance?.jti, "consent-test-jti");
  assert.equal(result?.consent_provenance?.subject_id, "user-1");
});

test("unsigned or subject-mismatched consent redacts click IDs", async () => {
  process.env.MARKETING_CONSENT_SIGNING_KEY = SIGNING_KEY;
  const token = await consentToken("different-user");

  const result = await normalizeMarketingAttribution(snapshot(token), "user-1");

  assert.equal(result?.ad_user_data_consent, "unspecified");
  assert.equal(result?.ad_personalization, "unspecified");
  assert.equal(result?.gclid, null);
  assert.equal(result?.gbraid, null);
  assert.equal(result?.wbraid, null);
  assert.equal(result?.first_touch?.click_id_value, "");
  assert.equal(result?.consent_provenance, null);
});
