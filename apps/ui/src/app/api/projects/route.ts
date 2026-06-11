import { type NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import {
  deleteProjectManagedResources,
  ProjectManagedResourceCleanupError,
} from "@/lib/project-persistence/delete-guard";
import {
  createProject,
  deleteProject,
  listProjects,
  ProjectPersistenceError,
  renameProject,
} from "@/lib/project-persistence/projects";
import { authorizeRequestNamespace } from "@/lib/request-kubeconfig-auth";
import {
  fetchServerCredentials,
  hasDevCredentialBypass,
} from "@/lib/server-credentials";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const boundedString = z.string().trim().min(1).max(256);
const createProjectRequestSchema = z.object({
  displayName: boundedString,
  namespace: boundedString,
});
const renameProjectRequestSchema = z.object({
  displayName: boundedString,
  id: boundedString,
  namespace: boundedString,
});
const deleteProjectRequestSchema = z.object({
  id: boundedString,
  namespace: boundedString,
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function authorizeNamespace(
  request: Request,
  namespace: string
):
  | { denied: null; encodedKubeconfig: string }
  | { denied: Response; encodedKubeconfig?: never } {
  if (hasDevCredentialBypass()) {
    return { denied: null, encodedKubeconfig: "" };
  }

  const authorization = authorizeRequestNamespace(request, {
    namespace,
    subject: "Project",
  });
  if (!authorization.ok) {
    return { denied: jsonError(authorization.message, authorization.status) };
  }
  return {
    denied: null,
    encodedKubeconfig: authorization.encodedKubeconfig,
  };
}

function persistenceError(error: ProjectPersistenceError): Response {
  if (error.code === "conflict") {
    return jsonError(error.message, 409);
  }
  if (error.code === "not_found") {
    return jsonError(error.message, 404);
  }
  return jsonError(error.message, 400);
}

function validationError(error: unknown): Response | null {
  if (error instanceof ZodError) {
    return jsonError("Invalid project request.", 400);
  }
  if (error instanceof ProjectManagedResourceCleanupError) {
    return jsonError(error.message, 502);
  }
  if (error instanceof ProjectPersistenceError) {
    return persistenceError(error);
  }
  return null;
}

export async function GET(request: NextRequest) {
  const namespace = boundedString.safeParse(
    request.nextUrl.searchParams.get("namespace") ?? ""
  );
  if (!namespace.success) {
    return jsonError("Invalid project request.", 400);
  }

  const authorization = await authorizeNamespace(request, namespace.data);
  if (authorization.denied !== null) {
    return authorization.denied;
  }

  try {
    return NextResponse.json({ projects: await listProjects(namespace.data) });
  } catch {
    return jsonError("Project persistence is unavailable.", 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createProjectRequestSchema.parse(await request.json());
    const authorization = await authorizeNamespace(request, body.namespace);
    if (authorization.denied !== null) {
      return authorization.denied;
    }
    return NextResponse.json(
      { project: await createProject(body) },
      { status: 201 }
    );
  } catch (error) {
    return (
      validationError(error) ??
      jsonError("Project persistence is unavailable.", 503)
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = renameProjectRequestSchema.parse(await request.json());
    const authorization = await authorizeNamespace(request, body.namespace);
    if (authorization.denied !== null) {
      return authorization.denied;
    }
    return NextResponse.json({ project: await renameProject(body) });
  } catch (error) {
    return (
      validationError(error) ??
      jsonError("Project persistence is unavailable.", 503)
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = deleteProjectRequestSchema.parse(await request.json());
    const authorization = await authorizeNamespace(request, body.namespace);
    if (authorization.denied !== null) {
      return authorization.denied;
    }
    const encodedKubeconfig =
      authorization.encodedKubeconfig ||
      (await fetchServerCredentials()).serverEncodedKubeconfig;
    if (encodedKubeconfig.trim() === "") {
      return jsonError("Authentication is required.", 401);
    }
    await deleteProjectManagedResources({
      encodedKubeconfig,
      id: body.id,
      namespace: body.namespace,
    });
    await deleteProject(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      validationError(error) ??
      jsonError("Project persistence is unavailable.", 503)
    );
  }
}
