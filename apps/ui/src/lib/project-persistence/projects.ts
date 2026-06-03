import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getProjectDb } from "./db";
import { type ProjectRow, projects } from "./schema";

export interface BrainProject {
  createdAt: string;
  displayName: string;
  id: string;
  namespace: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  displayName: string;
  namespace: string;
}

export interface RenameProjectInput {
  displayName: string;
  id: string;
  namespace: string;
}

export interface DeleteProjectInput {
  id: string;
  namespace: string;
}

export class ProjectPersistenceError extends Error {
  readonly code: "conflict" | "invalid" | "not_found";

  constructor(code: ProjectPersistenceError["code"], message: string) {
    super(message);
    this.name = "ProjectPersistenceError";
    this.code = code;
  }
}

function rowToProject(row: ProjectRow): BrainProject {
  return {
    createdAt: row.createdAt.toISOString(),
    displayName: row.displayName,
    id: row.id,
    namespace: row.namespace,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (normalized === "") {
    throw new ProjectPersistenceError("invalid", "Project name is required.");
  }
  return normalized;
}

function whereProject(namespace: string, id: string) {
  return and(eq(projects.namespace, namespace), eq(projects.id, id));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export async function listProjects(namespace: string): Promise<BrainProject[]> {
  const rows = await getProjectDb()
    .select()
    .from(projects)
    .where(eq(projects.namespace, namespace))
    .orderBy(projects.createdAt);
  return rows.map(rowToProject);
}

export async function createProject(
  input: CreateProjectInput
): Promise<BrainProject> {
  const now = new Date();
  const id = randomUUID();
  const displayName = normalizeDisplayName(input.displayName);

  try {
    const [row] = await getProjectDb()
      .insert(projects)
      .values({
        createdAt: now,
        displayName,
        id,
        namespace: input.namespace,
        updatedAt: now,
      })
      .returning();
    if (row === undefined) {
      throw new ProjectPersistenceError("invalid", "Project was not created.");
    }
    return rowToProject(row);
  } catch (error) {
    if (error instanceof ProjectPersistenceError) {
      throw error;
    }
    if (!isUniqueViolation(error)) {
      throw error;
    }
    throw new ProjectPersistenceError(
      "conflict",
      `A project named "${displayName}" already exists.`
    );
  }
}

export async function renameProject(
  input: RenameProjectInput
): Promise<BrainProject> {
  const displayName = normalizeDisplayName(input.displayName);
  try {
    const [row] = await getProjectDb()
      .update(projects)
      .set({ displayName, updatedAt: new Date() })
      .where(whereProject(input.namespace, input.id))
      .returning();
    if (row === undefined) {
      throw new ProjectPersistenceError("not_found", "Project not found.");
    }
    return rowToProject(row);
  } catch (error) {
    if (error instanceof ProjectPersistenceError) {
      throw error;
    }
    if (!isUniqueViolation(error)) {
      throw error;
    }
    throw new ProjectPersistenceError(
      "conflict",
      `A project named "${displayName}" already exists.`
    );
  }
}

export async function deleteProject(input: DeleteProjectInput): Promise<void> {
  const [row] = await getProjectDb()
    .delete(projects)
    .where(whereProject(input.namespace, input.id))
    .returning();
  if (row === undefined) {
    throw new ProjectPersistenceError("not_found", "Project not found.");
  }
}
