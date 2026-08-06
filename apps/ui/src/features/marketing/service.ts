import "server-only";

import { sql } from "drizzle-orm";

import { getMarketingDb } from "./db";
import { marketingLifecycleEvents } from "./schema";
import type { MarketingLifecycleEventInput } from "./types";

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

  const attribution = JSON.stringify({
    ad_user_data_consent: event.ad_user_data_consent,
    first_touch: event.first_touch,
    gbraid: event.gbraid,
    gclid: event.gclid,
    last_touch: event.last_touch,
    wbraid: event.wbraid,
  });
  await Promise.all(
    (
      [
        ["user", event.user_id],
        ["workspace", event.workspace_id],
      ] as const
    ).map(([subjectType, subjectId]) =>
      subjectId == null
        ? Promise.resolve()
        : getMarketingDb().execute(sql`
            SELECT "sealai_marketing"."upsert_attribution_subject"(
              ${subjectType}, ${subjectId}, ${attribution}::jsonb
            )
          `)
    )
  );
  return inserted.length === 0 ? "duplicate" : "created";
}
