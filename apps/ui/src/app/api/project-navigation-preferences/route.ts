import { type NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { MAX_PINNED_PROJECTS } from "@/lib/pinned-projects";
import {
  getProjectNavigationPreferences,
  updateProjectNavigationPreferences,
} from "@/lib/project-persistence/navigation-preferences";
import { authorizeRequestNamespace } from "@/lib/request-kubeconfig-auth";
import { hasDevCredentialBypass } from "@/lib/server-credentials";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const boundedString = z.string().trim().min(1).max(256);
const pinnedProjectIdsSchema = z.array(boundedString).max(MAX_PINNED_PROJECTS);
const updateNavigationPreferencesRequestSchema = z.object({
  namespace: boundedString,
  pinnedProjectIds: pinnedProjectIdsSchema,
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function authorizeNamespace(
  request: Request,
  namespace: string
): Response | null {
  if (hasDevCredentialBypass()) {
    return null;
  }

  const authorization = authorizeRequestNamespace(request, {
    namespace,
    subject: "Project navigation preferences",
  });
  if (!authorization.ok) {
    return jsonError(authorization.message, authorization.status);
  }
  return null;
}

function validationError(error: unknown): Response | null {
  if (error instanceof ZodError) {
    return jsonError("Invalid project navigation preferences request.", 400);
  }
  return null;
}

export async function GET(request: NextRequest) {
  const namespace = boundedString.safeParse(
    request.nextUrl.searchParams.get("namespace") ?? ""
  );
  if (!namespace.success) {
    return jsonError("Invalid project navigation preferences request.", 400);
  }

  const denied = authorizeNamespace(request, namespace.data);
  if (denied !== null) {
    return denied;
  }

  try {
    return NextResponse.json(
      await getProjectNavigationPreferences(namespace.data)
    );
  } catch {
    return jsonError("Project navigation preferences are unavailable.", 503);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = updateNavigationPreferencesRequestSchema.parse(
      await request.json()
    );
    const denied = authorizeNamespace(request, body.namespace);
    if (denied !== null) {
      return denied;
    }
    return NextResponse.json(await updateProjectNavigationPreferences(body));
  } catch (error) {
    return (
      validationError(error) ??
      jsonError("Project navigation preferences are unavailable.", 503)
    );
  }
}
