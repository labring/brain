import "server-only";

import { sql } from "drizzle-orm";

import { getMarketingDb } from "./db";
import {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
} from "./schema";
import type { MarketingLifecycleEventInput, MarketingTouch } from "./types";

async function upsertAttributionSubject(input: {
  adUserDataConsent: boolean;
  firstTouch: MarketingTouch | null;
  gbraid: string | null;
  gclid: string | null;
  lastTouch: MarketingTouch | null;
  subjectId: string | null;
  subjectType: "user" | "workspace";
  wbraid: string | null;
}): Promise<void> {
  if (input.subjectId == null) {
    return;
  }
  await getMarketingDb()
    .insert(marketingAttributionSubjects)
    .values({
      adUserDataConsent: input.adUserDataConsent ? "granted" : "denied",
      firstTouch: input.firstTouch,
      gbraid: input.gbraid,
      gclid: input.gclid,
      lastTouch: input.lastTouch,
      subjectId: input.subjectId,
      subjectType: input.subjectType,
      wbraid: input.wbraid,
    })
    .onConflictDoUpdate({
      set: {
        adUserDataConsent: input.adUserDataConsent ? "granted" : "denied",
        firstTouch: input.adUserDataConsent
          ? sql`coalesce(${marketingAttributionSubjects.firstTouch}, excluded.first_touch)`
          : input.firstTouch,
        gbraid: input.adUserDataConsent
          ? sql`coalesce(excluded.gbraid, ${marketingAttributionSubjects.gbraid})`
          : null,
        gclid: input.adUserDataConsent
          ? sql`coalesce(excluded.gclid, ${marketingAttributionSubjects.gclid})`
          : null,
        lastTouch: input.adUserDataConsent ? input.lastTouch : null,
        updatedAt: new Date(),
        wbraid: input.adUserDataConsent
          ? sql`coalesce(excluded.wbraid, ${marketingAttributionSubjects.wbraid})`
          : null,
      },
      target: [
        marketingAttributionSubjects.subjectType,
        marketingAttributionSubjects.subjectId,
      ],
    });
}

export async function recordMarketingLifecycleEvent(
  event: MarketingLifecycleEventInput
): Promise<"created" | "duplicate"> {
  const inserted = await getMarketingDb()
    .insert(marketingLifecycleEvents)
    .values({
      adUserDataConsent: event.ad_user_data_consent ? "granted" : "denied",
      currency: event.currency,
      deploymentId: event.deployment_id,
      eventId: event.event_id,
      eventName: event.event_name,
      firstTouch: event.first_touch,
      gbraid: event.gbraid,
      gclid: event.gclid,
      hashedUserData: event.hashed_user_data,
      lastTouch: event.last_touch,
      occurredAt: new Date(event.occurred_at),
      transactionId: event.transaction_id,
      userId: event.user_id,
      value: event.value == null ? undefined : event.value.toFixed(6),
      wbraid: event.wbraid,
      workspaceId: event.workspace_id,
    })
    .onConflictDoNothing()
    .returning({ eventId: marketingLifecycleEvents.eventId });

  await Promise.all([
    upsertAttributionSubject({
      adUserDataConsent: event.ad_user_data_consent,
      firstTouch: event.first_touch,
      gbraid: event.gbraid,
      gclid: event.gclid,
      lastTouch: event.last_touch,
      subjectId: event.user_id,
      subjectType: "user",
      wbraid: event.wbraid,
    }),
    upsertAttributionSubject({
      adUserDataConsent: event.ad_user_data_consent,
      firstTouch: event.first_touch,
      gbraid: event.gbraid,
      gclid: event.gclid,
      lastTouch: event.last_touch,
      subjectId: event.workspace_id,
      subjectType: "workspace",
      wbraid: event.wbraid,
    }),
  ]);
  return inserted.length === 0 ? "duplicate" : "created";
}
