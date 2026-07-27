import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import {
  fallbackProjectDisplayName,
  projectDisplayNameWithSuffix,
} from "@/features/projects/derived-project-display-name";

import { getProjectDb } from "./db";
import { type ProjectRow, projects } from "./schema";

/** Bounded so a crowded namespace ends on a fallback name instead of spinning. */
const DISPLAY_NAME_SUFFIX_ATTEMPTS = 20;
const FALLBACK_DISPLAY_NAME_ATTEMPTS = 5;

export interface BrainProject {
  createdAt: string;
  description: string;
  displayName: string;
  id: string;
  namespace: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  description?: string;
  displayName: string;
  namespace: string;
}

export interface UpdateProjectInput {
  description?: string;
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
    description: row.description,
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

function normalizeDescription(description: string | undefined): string {
  const normalized = description?.trim() ?? "";
  if (normalized.length > 256) {
    throw new ProjectPersistenceError(
      "invalid",
      "Project description must be 256 characters or fewer."
    );
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
    // Newest first, so freshly created projects surface at the top of the list.
    .orderBy(desc(projects.createdAt));
  return rows.map(rowToProject);
}

export async function getProject(
  namespace: string,
  id: string
): Promise<BrainProject | null> {
  const [row] = await getProjectDb()
    .select()
    .from(projects)
    .where(whereProject(namespace, id))
    .limit(1);
  return row === undefined ? null : rowToProject(row);
}

export async function createProject(
  input: CreateProjectInput
): Promise<BrainProject> {
  const now = new Date();
  const id = randomUUID();
  const displayName = normalizeDisplayName(input.displayName);
  const description = normalizeDescription(input.description);

  try {
    const [row] = await getProjectDb()
      .insert(projects)
      .values({
        createdAt: now,
        description,
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

async function createProjectIfNameFree(
  input: CreateProjectInput
): Promise<BrainProject | null> {
  try {
    return await createProject(input);
  } catch (error) {
    if (error instanceof ProjectPersistenceError && error.code === "conflict") {
      return null;
    }
    throw error;
  }
}

async function createProjectUnderFreeSuffix(input: {
  description?: string;
  displayNameBase: string;
  namespace: string;
}): Promise<BrainProject | null> {
  for (let attempt = 1; attempt <= DISPLAY_NAME_SUFFIX_ATTEMPTS; attempt += 1) {
    const project = await createProjectIfNameFree({
      description: input.description,
      displayName: projectDisplayNameWithSuffix(input.displayNameBase, attempt),
      namespace: input.namespace,
    });
    if (project !== null) {
      return project;
    }
  }
  return null;
}

/**
 * Creates a Project under a platform-derived name (ADR 0058). The unique index
 * is the arbiter, not a pre-read: each rejected insert bumps the suffix, so two
 * concurrent creates from the same Deployment Source both succeed with distinct
 * names instead of one failing on a stale uniqueness check.
 */
export async function createProjectWithDerivedDisplayName(input: {
  derivedDisplayName: string;
  description?: string;
  namespace: string;
}): Promise<BrainProject> {
  const derived = await createProjectUnderFreeSuffix({
    description: input.description,
    displayNameBase: input.derivedDisplayName,
    namespace: input.namespace,
  });
  if (derived !== null) {
    return derived;
  }
  // A namespace crowded enough to exhaust the derived name's suffixes still
  // gets a readable name, suffixed the same way rather than retried blindly.
  for (
    let attempt = 0;
    attempt < FALLBACK_DISPLAY_NAME_ATTEMPTS;
    attempt += 1
  ) {
    const project = await createProjectUnderFreeSuffix({
      description: input.description,
      displayNameBase: fallbackProjectDisplayName(),
      namespace: input.namespace,
    });
    if (project !== null) {
      return project;
    }
  }
  throw new ProjectPersistenceError(
    "conflict",
    "Could not find an available project name."
  );
}

export async function updateProject(
  input: UpdateProjectInput
): Promise<BrainProject> {
  const displayName = normalizeDisplayName(input.displayName);
  const description =
    input.description === undefined
      ? undefined
      : normalizeDescription(input.description);
  try {
    const nextValues = {
      ...(description === undefined ? {} : { description }),
      displayName,
      updatedAt: new Date(),
    };
    const [row] = await getProjectDb()
      .update(projects)
      .set(nextValues)
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
