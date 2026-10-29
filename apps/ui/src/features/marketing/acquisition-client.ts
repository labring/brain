import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { verifyMarketingConsentToken } from "./consent";
import {
  type MarketingAttributionSnapshot,
  type MarketingTouch,
  marketingTouchSchema,
} from "./types";

const consentState = z.enum(["granted", "denied", "unspecified"]);
const responseSchema = z.object({
  version: z.literal(1),
  subject_id: z.string().min(1).max(512),
  realm: z.enum(["china", "global"]),
  sea_attr: z.string().min(1).max(16_384),
  consent_token: z.string().min(1).max(8192),
  consent: z.object({
    analytics_storage: consentState,
    ad_storage: consentState,
    ad_user_data: consentState,
    ad_personalization: consentState,
  }),
  linked_at: z.string().datetime({ offset: true }),
});

export type AcquisitionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface AcquisitionClientConfig {
  baseUrl: string;
  secret: string;
}

export interface AccountAcquisition {
  realm: "china" | "global";
  snapshot: MarketingAttributionSnapshot;
}

export function acquisitionClientConfig(
  env: Record<string, string | undefined> = process.env
): AcquisitionClientConfig | null {
  const baseUrl = env.MARKETING_ATTRIBUTION_API_BASE_URL?.trim() ?? "";
  const secret = env.ACQUISITION_INGEST_SECRET?.trim() ?? "";
  if (baseUrl === "" && secret === "") {
    return null;
  }
  if (!(baseUrl && secret)) {
    throw new Error("Marketing acquisition configuration is incomplete.");
  }
  const url = new URL(baseUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Marketing acquisition authority must be an HTTPS origin.");
  }
  return { baseUrl: url.origin, secret };
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function touch(value: unknown, granted: boolean): MarketingTouch | null {
  const raw = record(value);
  if (raw == null) {
    return null;
  }
  const clickType = ["gclid", "gbraid", "wbraid"].includes(
    String(raw.click_id_type)
  )
    ? raw.click_id_type
    : "";
  const parsed = marketingTouchSchema.safeParse({
    campaign: raw.campaign ?? "",
    channel: raw.channel ?? "",
    click_id_type: clickType,
    click_id_value: granted && clickType ? (raw.click_id_value ?? "") : "",
    content: raw.content ?? "",
    landing_hostname: raw.landing_hostname ?? "",
    landing_path: raw.landing_path ?? "",
    medium: raw.medium ?? "",
    source: raw.source ?? "",
    term: raw.term ?? "",
    ts: raw.ts,
  });
  return parsed.success ? parsed.data : null;
}

export async function fetchAccountAcquisition(
  subjectId: string,
  options: {
    config?: AcquisitionClientConfig | null;
    fetch?: AcquisitionFetch;
  } = {}
): Promise<AccountAcquisition | null> {
  const config =
    options.config === undefined ? acquisitionClientConfig() : options.config;
  if (config == null) {
    return null;
  }
  const url = new URL("/api/marketing/acquisition/subject", config.baseUrl);
  url.searchParams.set("subject_id", subjectId);
  const response = await (options.fetch ?? fetch)(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${config.secret}` },
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Marketing acquisition lookup failed.");
  }
  const text = await response.text();
  if (text.length > 65_536) {
    throw new Error("Marketing acquisition response exceeds its size limit.");
  }
  const linked = responseSchema.parse(JSON.parse(text));
  if (linked.subject_id !== subjectId) {
    throw new Error("Marketing acquisition subject mismatch.");
  }
  if (linked.consent.analytics_storage !== "granted") {
    return null;
  }
  const verified = await verifyMarketingConsentToken(
    linked.consent_token,
    subjectId
  );
  if (
    verified == null ||
    createHash("sha256").update(linked.sea_attr).digest("hex") !==
      verified.attribution_hash
  ) {
    throw new Error("Marketing acquisition receipt is unverifiable.");
  }
  const raw = record(
    JSON.parse(Buffer.from(linked.sea_attr, "base64url").toString("utf8"))
  );
  if (raw?.version !== 2 && raw?.version !== 3) {
    throw new Error("Marketing acquisition snapshot version is unsupported.");
  }
  const granted = verified.ad_user_data_consent === "granted";
  const first = touch(raw.first_touch, granted);
  const last = touch(raw.last_touch ?? raw.last_qualified_touch, granted);
  const candidates = Array.isArray(raw.click_id_candidates)
    ? raw.click_id_candidates
        .slice(0, 6)
        .map((value) => touch(value, granted))
        .filter((value): value is MarketingTouch => value != null)
    : [];
  const ids: {
    gclid: string | null;
    gbraid: string | null;
    wbraid: string | null;
  } = { gclid: null, gbraid: null, wbraid: null };
  for (const candidate of [...candidates, last, first]) {
    if (candidate?.click_id_type && candidate.click_id_value) {
      ids[candidate.click_id_type] ??= candidate.click_id_value;
    }
  }
  return {
    realm: linked.realm,
    snapshot: {
      version: 3,
      ad_personalization: verified.ad_personalization,
      ad_user_data_consent: verified.ad_user_data_consent,
      attribution_raw: linked.sea_attr,
      consent_token: linked.consent_token,
      consent_provenance: null,
      first_touch: first,
      last_touch: last,
      click_id_candidates: candidates,
      ...ids,
    },
  };
}

/** Prefer the linked account source while preserving the existing deployment path on analytics failure. */
export async function deploymentAccountAttribution(
  subjectId: string | undefined,
  inbound: MarketingAttributionSnapshot | undefined
): Promise<MarketingAttributionSnapshot | undefined> {
  if (subjectId == null) {
    return inbound;
  }
  try {
    return (await fetchAccountAcquisition(subjectId))?.snapshot ?? inbound;
  } catch {
    console.warn(
      "[marketing-acquisition] deployment attribution lookup unavailable"
    );
    return inbound;
  }
}
