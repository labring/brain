import "server-only";

import { and, eq } from "drizzle-orm";

import { getProjectDb } from "@/lib/project-persistence/db";
import {
  type ProjectCanvasLayoutRow,
  projectCanvasLayouts,
} from "@/lib/project-persistence/schema";

import { cleanupCanvasLayoutDocument } from "./cleanup";
import { parseCanvasLayoutDocument } from "./contract";
import { applyCanvasLayoutPatch, CanvasLayoutValidationError } from "./patch";
import type { CanvasLayoutDocument, CanvasLayoutPatch } from "./types";

export interface ProjectCanvasLayoutKey {
  namespace: string;
  projectId: string;
}

function emptyLayoutDocument(
  key: ProjectCanvasLayoutKey
): CanvasLayoutDocument {
  return {
    namespace: key.namespace,
    nodes: [],
    projectId: key.projectId,
    version: 0,
  };
}

function rowToDocument(
  row: ProjectCanvasLayoutRow,
  options?: { now?: Date }
): CanvasLayoutDocument {
  return cleanupCanvasLayoutDocument(
    parseCanvasLayoutDocument({
      namespace: row.namespace,
      nodes: row.nodes,
      ...(row.projectNameSnapshot == null
        ? {}
        : { projectNameSnapshot: row.projectNameSnapshot }),
      projectId: row.projectId,
      version: row.version,
    }),
    options
  );
}

function whereLayoutKey(key: ProjectCanvasLayoutKey) {
  return and(
    eq(projectCanvasLayouts.namespace, key.namespace),
    eq(projectCanvasLayouts.projectId, key.projectId)
  );
}

function normalizeNodeForProject(
  key: ProjectCanvasLayoutKey,
  node: CanvasLayoutPatch["nodes"][number]
) {
  const namespace = node.ref.namespace.trim();
  if (namespace !== key.namespace) {
    throw new CanvasLayoutValidationError(
      "node namespace must match layout namespace."
    );
  }

  return {
    ...node,
    ref: {
      ...node.ref,
      namespace,
    },
  };
}

function normalizePatchForProject(
  key: ProjectCanvasLayoutKey,
  patch: CanvasLayoutPatch
): CanvasLayoutPatch {
  return {
    ...patch,
    nodes: patch.nodes.map((node) => normalizeNodeForProject(key, node)),
  };
}

export async function loadProjectCanvasLayout(
  key: ProjectCanvasLayoutKey
): Promise<CanvasLayoutDocument> {
  const now = new Date();
  const [row] = await getProjectDb()
    .select()
    .from(projectCanvasLayouts)
    .where(whereLayoutKey(key))
    .limit(1);
  return row === undefined
    ? emptyLayoutDocument(key)
    : rowToDocument(row, { now });
}

export function patchProjectCanvasLayout(
  key: ProjectCanvasLayoutKey,
  patch: CanvasLayoutPatch
): Promise<CanvasLayoutDocument> {
  return getProjectDb().transaction(async (tx) => {
    const now = new Date();
    await tx
      .insert(projectCanvasLayouts)
      .values({
        namespace: key.namespace,
        nodes: [],
        projectNameSnapshot: patch.projectNameSnapshot,
        projectId: key.projectId,
        updatedAt: now,
        createdAt: now,
        version: 0,
      })
      .onConflictDoNothing({
        target: [
          projectCanvasLayouts.namespace,
          projectCanvasLayouts.projectId,
        ],
      });

    const [row] = await tx
      .select()
      .from(projectCanvasLayouts)
      .where(whereLayoutKey(key))
      .limit(1)
      .for("update");

    const existing =
      row === undefined
        ? emptyLayoutDocument(key)
        : rowToDocument(row, { now });
    const next = applyCanvasLayoutPatch(
      existing,
      normalizePatchForProject(key, patch),
      { now }
    );

    const [updated] = await tx
      .update(projectCanvasLayouts)
      .set({
        nodes: next.nodes,
        projectNameSnapshot: next.projectNameSnapshot,
        updatedAt: now,
        version: next.version,
      })
      .where(whereLayoutKey(key))
      .returning();

    return updated === undefined ? next : rowToDocument(updated, { now });
  });
}
