import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type {
  MarketingConsentState,
  MarketingLifecycleEventName,
  MarketingTouch,
} from "./types";

export const MARKETING_DB_SCHEMA = "sealai_marketing";
export const ns = pgSchema(MARKETING_DB_SCHEMA);

export type MarketingAttributionSubjectType = "user" | "workspace";
export type MarketingLifecycleEventStatus = "failed" | "pending" | "uploaded";

export const marketingAttributionSubjects = ns.table(
  "attribution_subjects",
  {
    subjectType: text("subject_type")
      .notNull()
      .$type<MarketingAttributionSubjectType>(),
    subjectId: text("subject_id").notNull(),
    firstTouch: jsonb("first_touch").$type<MarketingTouch | null>(),
    lastTouch: jsonb("last_touch").$type<MarketingTouch | null>(),
    gclid: text("gclid"),
    gbraid: text("gbraid"),
    wbraid: text("wbraid"),
    adPersonalization: text("ad_personalization")
      .notNull()
      .$type<MarketingConsentState>()
      .default("unspecified"),
    adUserDataConsent: text("ad_user_data_consent")
      .notNull()
      .$type<MarketingConsentState>()
      .default("unspecified"),
    clickIdCandidates: jsonb("click_id_candidates").$type<MarketingTouch[]>(),
    consentProvenance: jsonb("consent_provenance").$type<{
      issuer: string;
      issued_at: string;
      jti: string;
      region: string;
      source: "desktop_oauth";
      subject_id: string;
    } | null>(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.subjectType, table.subjectId],
      name: "attribution_subjects_pk",
    }),
  ]
);

export const marketingLifecycleEvents = ns.table(
  "lifecycle_events",
  {
    eventId: text("event_id").primaryKey(),
    eventName: text("event_name")
      .notNull()
      .$type<MarketingLifecycleEventName>(),
    userId: text("user_id"),
    workspaceId: text("workspace_id"),
    deploymentId: text("deployment_id"),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    firstTouch: jsonb("first_touch").$type<MarketingTouch | null>(),
    lastTouch: jsonb("last_touch").$type<MarketingTouch | null>(),
    gclid: text("gclid"),
    gbraid: text("gbraid"),
    wbraid: text("wbraid"),
    adPersonalization: text("ad_personalization")
      .notNull()
      .$type<MarketingConsentState>()
      .default("unspecified"),
    adUserDataConsent: text("ad_user_data_consent")
      .notNull()
      .$type<MarketingConsentState>()
      .default("unspecified"),
    clickIdCandidates: jsonb("click_id_candidates").$type<MarketingTouch[]>(),
    consentProvenance: jsonb("consent_provenance").$type<{
      issuer: string;
      issued_at: string;
      jti: string;
      region: string;
      source: "desktop_oauth";
      subject_id: string;
    } | null>(),
    hashedUserData: jsonb("hashed_user_data").$type<{
      email_sha256?: string;
      phone_sha256?: string;
    } | null>(),
    transactionId: text("transaction_id"),
    currency: text("currency"),
    value: numeric("value", { precision: 24, scale: 6 }),
    status: text("status")
      .notNull()
      .$type<MarketingLifecycleEventStatus>()
      .default("pending"),
    uploadError: text("upload_error"),
    uploadRequestId: text("upload_request_id"),
    uploadedAt: timestamp("uploaded_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("lifecycle_events_pending_idx")
      .on(table.occurredAt)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("lifecycle_events_action_transaction_idx")
      .on(table.eventName, table.transactionId)
      .where(sql`${table.transactionId} IS NOT NULL`),
  ]
);
