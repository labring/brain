import "server-only";

import { sql } from "drizzle-orm";

import { normalizeMarketingAttribution } from "./consent";
import { getMarketingDb } from "./db";
import { marketingLifecycleEvents } from "./schema";
import type { MarketingLifecycleEventInput } from "./types";

export async function recordMarketingLifecycleEvent(
  event: MarketingLifecycleEventInput
): Promise<"created" | "duplicate"> {
  const normalizedAttribution = await normalizeMarketingAttribution(
    {
      ad_personalization: event.ad_personalization,
      ad_user_data_consent: event.ad_user_data_consent,
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

  return await getMarketingDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(marketingLifecycleEvents)
      .values({
        adPersonalization: normalizedAttribution.ad_personalization,
        adUserDataConsent: normalizedAttribution.ad_user_data_consent,
        clickIdCandidates: normalizedAttribution.click_id_candidates,
        consentProvenance: normalizedAttribution.consent_provenance,
        currency: event.currency,
        deploymentId: event.deployment_id,
        eventId: event.event_id,
        eventName: event.event_name,
        firstTouch: normalizedAttribution.first_touch,
        gbraid: normalizedAttribution.gbraid,
        gclid: normalizedAttribution.gclid,
        hashedUserData:
          normalizedAttribution.ad_user_data_consent === "granted"
            ? event.hashed_user_data
            : undefined,
        lastTouch: normalizedAttribution.last_touch,
        occurredAt: new Date(event.occurred_at),
        transactionId: event.transaction_id,
        userId: event.user_id,
        value: event.value == null ? undefined : event.value.toFixed(6),
        wbraid: normalizedAttribution.wbraid,
        workspaceId: event.workspace_id,
      })
      .onConflictDoNothing()
      .returning({ eventId: marketingLifecycleEvents.eventId });

    if (inserted.length === 0) {
      return "duplicate";
    }

    const attribution = JSON.stringify(normalizedAttribution);
    for (const [subjectType, subjectId] of [
      ["user", event.user_id],
      ["workspace", event.workspace_id],
    ] as const) {
      if (subjectId == null) {
        continue;
      }
      try {
        await tx.execute(sql`
          SELECT "sealai_marketing"."upsert_attribution_subject"(
            ${subjectType}, ${subjectId}, ${attribution}::jsonb
          )
        `);
      } catch (error) {
        console.warn("[marketing] attribution subject repair queued", {
          error,
          eventId: event.event_id,
          subjectId,
          subjectType,
        });
      }
    }
    return "created";
  });
}
