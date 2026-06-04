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
    // Keep the physical column name for now; app-level meaning is Brain DB projectId.
    projectUid: text("project_uid").notNull(),
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
      columns: [table.namespace, table.projectUid],
      name: "project_canvas_layouts_pk",
    }),
    index("project_canvas_layouts_updated_at_idx").on(table.updatedAt),
  ]
);

/** AP image version history, used by the workload History panel. */
export const apImageVersions = ns.table(
  "ap_image_versions",
  {
    namespace: text("namespace").notNull(),
    apName: text("ap_name").notNull(),
    versionHash: text("version_hash").notNull(),
    image: text("image").notNull(),
    imagePullPolicy: text("image_pull_policy"),
    source: text("source").notNull().default("update"),
    specSnapshot: jsonb("spec_snapshot"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.namespace, table.apName, table.versionHash],
      name: "ap_image_versions_pk",
    }),
    index("ap_image_versions_lookup_idx").on(
      table.namespace,
      table.apName,
      table.createdAt
    ),
  ]
);

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectCanvasLayoutRow = typeof projectCanvasLayouts.$inferSelect;
export type APImageVersionRow = typeof apImageVersions.$inferSelect;
