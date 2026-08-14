import "server-only";

import { sql } from "drizzle-orm";

import { canonicalIdentityUid } from "@/lib/identity-uid-canonicalization";
import { normalizeMarketingAttribution } from "./consent";
import { getMarketingDb, type MarketingPgDatabase } from "./db";
import { marketingLifecycleEvents } from "./schema";
import type { MarketingLifecycleEventInput } from "./types";

export async function recordMarketingLifecycleEvent(
  event: MarketingLifecycleEventInput,
  options: {
    beforeTransaction?: () => Promise<void>;
    getDb?: () => MarketingPgDatabase;
  } = {}
): Promise<"created" | "duplicate"> {
  const normalizedAttribution = await normalizeMarketingAttribution(
    {
      ad_personalization: event.ad_personalization,
      ad_user_data_consent: event.ad_user_data_consent,
      attribution_raw: event.attribution_raw,
      click_id_candidates: event.click_id_candidates,
      consent_provenance: event.consent_provenance,
      consent_token: event.consent_token,
      first_touch: event.first_touch,
      gbraid: event.gbraid,
      gclid: event.gclid,
      last_touch: event.last_touch,
      version: event.version,
      wbraid: event.wbraid,
    },
    event.user_id
  );
  if (normalizedAttribution == null) {
    throw new Error("Invalid marketing attribution payload.");
  }
  await options.beforeTransaction?.();

  return await (options.getDb ?? getMarketingDb)().transaction(async (tx) => {
    const provenance = normalizedAttribution.consent_provenance;
    let userId: string | null = null;
    let attribution = normalizedAttribution;
    if (provenance != null) {
      userId = await canonicalIdentityUid(tx, provenance.subject_id);
      if (provenance.subject_id !== userId) {
        attribution = {
          ...normalizedAttribution,
          consent_provenance: { ...provenance, subject_id: userId },
        };
      }
    }
    const inserted = await tx
      .insert(marketingLifecycleEvents)
      .values({
        adPersonalization: attribution.ad_personalization,
        adUserDataConsent: attribution.ad_user_data_consent,
        clickIdCandidates: attribution.click_id_candidates,
        consentProvenance: attribution.consent_provenance,
        currency: event.currency,
        deploymentId: event.deployment_id,
        eventId: event.event_id,
        eventName: event.event_name,
        firstTouch: attribution.first_touch,
        gbraid: attribution.gbraid,
        gclid: attribution.gclid,
        hashedUserData:
          attribution.ad_user_data_consent === "granted"
            ? event.hashed_user_data
            : undefined,
        lastTouch: attribution.last_touch,
        occurredAt: new Date(event.occurred_at),
        transactionId: event.transaction_id,
        userId,
        value: event.value == null ? undefined : event.value.toFixed(6),
        wbraid: attribution.wbraid,
        workspaceId: event.workspace_id,
      })
      .onConflictDoNothing()
      .returning({ eventId: marketingLifecycleEvents.eventId });

    if (inserted.length === 0) {
      return "duplicate";
    }

    const attributionJson = JSON.stringify(attribution);
    for (const [subjectType, subjectId] of [
      ["user", userId],
      ["workspace", event.workspace_id],
    ] as const) {
      if (subjectId == null) {
        continue;
      }
      await tx.execute(sql`
        SELECT "sealai_marketing"."upsert_attribution_subject"(
          ${subjectType}, ${subjectId}, ${attributionJson}::jsonb
        )
      `);
    }
    return "created";
  });
}
