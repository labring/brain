import {
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { CanvasLayoutNode } from "@/features/project-canvas/layout/types";

import { PROJECT_DB_SCHEMA } from "./types";

export const ns = pgSchema(PROJECT_DB_SCHEMA);

/** Shared Project canvas layout, keyed by Kubernetes namespace and stable Project UID. */
export const projectCanvasLayouts = ns.table(
  "project_canvas_layouts",
  {
    namespace: text("namespace").notNull(),
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

export type ProjectCanvasLayoutRow = typeof projectCanvasLayouts.$inferSelect;
