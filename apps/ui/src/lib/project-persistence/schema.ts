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
    uniqueIndex("projects_namespace_display_name_idx").on(
      table.namespace,
      table.displayName
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

// `sealai_project.ap_image_versions` is intentionally NOT declared here: the Go
// API owns that table end-to-end (DDL + retention pruning) in
// `apps/api/service/apversion/store.go`; the UI only reads it over HTTP.

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectCanvasLayoutRow = typeof projectCanvasLayouts.$inferSelect;
export type ProjectNavigationPreferencesRow =
  typeof projectNavigationPreferences.$inferSelect;
