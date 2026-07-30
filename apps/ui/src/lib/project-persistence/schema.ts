import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { CanvasLayoutNode } from "@/features/project-canvas/layout/types";

import type { ProjectChildResourceSummary } from "./delete-guard";
import { PROJECT_DB_SCHEMA } from "./types";

export const ns = pgSchema(PROJECT_DB_SCHEMA);

/** Brain product Projects, keyed by Space namespace and stable app-owned ID. */
export const projects = ns.table(
  "projects",
  {
    namespace: text("namespace").notNull(),
    id: text("id").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull().default(""),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.namespace, table.id],
      name: "projects_pk",
    }),
    // Uniqueness authority for Project Display Names (ADR 0058). Humans read
    // `nginx` and `Nginx` as the same row, so the database — not a pre-read
    // that concurrent creates can race — enforces case-insensitive uniqueness.
    // The trimming half of the contract is an invariant of the column instead:
    // every write goes through `normalizeDisplayName`, so stored names carry no
    // surrounding whitespace and `lower()` is already the compared form. Keep it
    // that way — `lower(trim())` here would not match JS `trim()` anyway
    // (Postgres `btrim` strips spaces only, not tabs or newlines).
    uniqueIndex("projects_namespace_lower_display_name_idx").on(
      table.namespace,
      sql`lower(${table.displayName})`
    ),
    index("projects_updated_at_idx").on(table.updatedAt),
  ]
);

/** Shared Project canvas layout, keyed by namespace and stable Brain Project ID. */
export const projectCanvasLayouts = ns.table(
  "project_canvas_layouts",
  {
    namespace: text("namespace").notNull(),
    // Storage migration boundary: the physical column remains `project_uid`;
    // the app-level contract is the Brain Project ID.
    projectId: text("project_uid").notNull(),
    projectNameSnapshot: text("project_name_snapshot"),
    version: integer("version").notNull().default(0),
    nodes: jsonb("nodes").notNull().$type<CanvasLayoutNode[]>(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.namespace, table.projectId],
      name: "project_canvas_layouts_pk",
    }),
    index("project_canvas_layouts_updated_at_idx").on(table.updatedAt),
  ]
);

/** Namespace-scoped Project navigation preferences. */
export const projectNavigationPreferences = ns.table(
  "project_navigation_preferences",
  {
    namespace: text("namespace").notNull(),
    pinnedProjectIds: jsonb("pinned_project_ids").notNull().$type<string[]>(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.namespace],
      name: "project_navigation_preferences_pk",
    }),
    index("project_navigation_preferences_updated_at_idx").on(table.updatedAt),
  ]
);

/** One-time, actor-bound evidence for an Agent-requested Project deletion. */
export const projectDeletePreviews = ns.table(
  "project_delete_previews",
  {
    id: text("id").notNull(),
    actorUid: text("actor_uid").notNull(),
    chatId: text("chat_id").notNull(),
    namespace: text("namespace").notNull(),
    projectId: text("project_id").notNull(),
    displayName: text("display_name").notNull(),
    resourceSummary: jsonb("resource_summary")
      .notNull()
      .$type<ProjectChildResourceSummary>(),
    fingerprint: text("fingerprint").notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.id],
      name: "project_delete_previews_pk",
    }),
    index("project_delete_previews_expires_at_idx").on(table.expiresAt),
    index("project_delete_previews_target_idx").on(
      table.namespace,
      table.projectId
    ),
  ]
);

/** Short-lived mutual exclusion for external Project resource cleanup. */
export const projectDeleteOperations = ns.table(
  "project_delete_operations",
  {
    namespace: text("namespace").notNull(),
    projectId: text("project_id").notNull(),
    actorUid: text("actor_uid").notNull(),
    previewId: text("preview_id").notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.namespace, table.projectId],
      name: "project_delete_operations_pk",
    }),
    index("project_delete_operations_expires_at_idx").on(table.expiresAt),
  ]
);

/** Durable Agent Project-management audit trail; deliberately independent of Project deletion. */
export const projectManagementAuditEvents = ns.table(
  "project_management_audit_events",
  {
    id: text("id").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    actorUid: text("actor_uid").notNull(),
    chatId: text("chat_id").notNull(),
    namespace: text("namespace").notNull(),
    projectId: text("project_id").notNull(),
    displayName: text("display_name").notNull(),
    resourceSummary: jsonb("resource_summary")
      .notNull()
      .$type<ProjectChildResourceSummary>(),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.id],
      name: "project_management_audit_events_pk",
    }),
    index("project_management_audit_events_target_idx").on(
      table.namespace,
      table.projectId,
      table.createdAt
    ),
  ]
);

// `sealai_project.ap_image_versions` is intentionally NOT declared here: the Go
// API owns that table end-to-end (DDL + retention pruning) in
// `apps/api/service/apversion/store.go`; the UI only reads it over HTTP.

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectCanvasLayoutRow = typeof projectCanvasLayouts.$inferSelect;
export type ProjectNavigationPreferencesRow =
  typeof projectNavigationPreferences.$inferSelect;
export type ProjectDeletePreviewRow = typeof projectDeletePreviews.$inferSelect;
