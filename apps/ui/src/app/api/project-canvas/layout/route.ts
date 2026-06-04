import { type NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  assertCanvasLayoutPatchMatchesOwner,
  parseCanvasLayoutGetQuery,
  parseCanvasLayoutPatchRequest,
} from "@/features/project-canvas/layout/contract";
import { CanvasLayoutValidationError } from "@/features/project-canvas/layout/patch";
import {
  loadProjectCanvasLayout,
  patchProjectCanvasLayout,
} from "@/features/project-canvas/layout/repository";
import {
  fetchServerCredentials,
  hasDevCredentialBypass,
} from "@/lib/server-credentials";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function authorizeNamespace(namespace: string): Promise<Response | null> {
  if (hasDevCredentialBypass()) {
    return null;
  }

  const credentials = await fetchServerCredentials();
  if (credentials.serverEncodedKubeconfig.trim() === "") {
    return jsonError("Authentication is required.", 401);
  }
  if (credentials.serverNamespace.trim() !== namespace) {
    return jsonError("Canvas layout namespace is not accessible.", 403);
  }
  return null;
}

function authorizeLayoutRead(
  query: ReturnType<typeof parseCanvasLayoutGetQuery>
): Promise<Response | null> {
  return authorizeNamespace(query.namespace);
}

function validationError(error: unknown): Response | null {
  if (
    error instanceof ZodError ||
    error instanceof CanvasLayoutValidationError
  ) {
    return jsonError("Invalid canvas layout request.", 400);
  }
  return null;
}

export async function GET(request: NextRequest) {
  let query: ReturnType<typeof parseCanvasLayoutGetQuery>;
  try {
    query = parseCanvasLayoutGetQuery({
      namespace: request.nextUrl.searchParams.get("namespace") ?? "",
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
    });
  } catch (error) {
    return validationError(error) ?? jsonError("Invalid request.", 400);
  }

  const denied = await authorizeLayoutRead(query);
  if (denied !== null) {
    return denied;
  }

  try {
    return NextResponse.json(
      await loadProjectCanvasLayout({
        namespace: query.namespace,
        projectId: query.projectId,
      })
    );
  } catch {
    return jsonError("Canvas layout persistence is unavailable.", 503);
  }
}

export async function PATCH(request: NextRequest) {
  let body: ReturnType<typeof parseCanvasLayoutPatchRequest>;
  try {
    body = parseCanvasLayoutPatchRequest(await request.json());
    assertCanvasLayoutPatchMatchesOwner(body);
  } catch (error) {
    return (
      validationError(error) ?? jsonError("Invalid canvas layout request.", 400)
    );
  }

  const denied = await authorizeNamespace(body.namespace);
  if (denied !== null) {
    return denied;
  }

  try {
    const { namespace, projectId, ...patch } = body;
    return NextResponse.json(
      await patchProjectCanvasLayout({ namespace, projectId }, patch)
    );
  } catch (error) {
    return (
      validationError(error) ??
      jsonError("Canvas layout persistence is unavailable.", 503)
    );
  }
}
