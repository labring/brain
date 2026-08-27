import { type NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import {
  adoptTemplateInstance,
  TemplateInstanceAdoptionError,
} from "@/lib/project-persistence/adopt-template-instance";
import { ProjectPersistenceError } from "@/lib/project-persistence/projects";
import {
  authorizeKubeconfigNamespace,
  encodedKubeconfigFromRequest,
} from "@/lib/request-kubeconfig-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const boundedName = z.string().trim().min(1).max(253);
const boundedDisplayName = z.string().trim().min(1).max(256);
const optionalDescription = z.string().trim().max(256).optional();
const optionalTemplateName = z.string().trim().max(256).optional();

const adoptTemplateInstanceRequestSchema = z.object({
  description: optionalDescription,
  displayName: boundedDisplayName.optional(),
  instanceName: boundedName,
  templateName: optionalTemplateName,
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function authorizationError(
  authorization: Exclude<
    Awaited<ReturnType<typeof authorizeKubeconfigNamespace>>,
    { ok: true }
  >
): Response {
  if (authorization.code === "verification_failed") {
    if (authorization.status === 403) {
      return jsonError("Namespace is not accessible.", 403);
    }
    if (authorization.status === 401) {
      return jsonError("Authentication is required.", 401);
    }
    return jsonError(authorization.message, authorization.status);
  }
  if (authorization.code === "authentication_required") {
    return jsonError("Authentication is required.", 401);
  }
  if (authorization.code === "invalid_kubeconfig") {
    return jsonError("Invalid kubeconfig.", 400);
  }
  if (authorization.code === "namespace_unresolved") {
    return jsonError("Could not resolve namespace from kubeconfig.", 400);
  }
  return jsonError("Namespace is not accessible.", 403);
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

function adoptionFailure(error: unknown): Response | null {
  if (error instanceof ZodError) {
    return jsonError("Invalid project request.", 400);
  }
  if (error instanceof TemplateInstanceAdoptionError) {
    return jsonError(error.message, error.status);
  }
  if (error instanceof ProjectPersistenceError) {
    return persistenceError(error);
  }
  return null;
}

export async function POST(request: NextRequest) {
  let body: z.infer<typeof adoptTemplateInstanceRequestSchema>;
  try {
    body = adoptTemplateInstanceRequestSchema.parse(await request.json());
  } catch (error) {
    return adoptionFailure(error) ?? jsonError("Invalid project request.", 400);
  }

  const authorization = await authorizeKubeconfigNamespace({
    encodedKubeconfig: encodedKubeconfigFromRequest(request),
  });
  if (!authorization.ok) {
    return authorizationError(authorization);
  }

  try {
    return NextResponse.json(
      await adoptTemplateInstance({
        description: body.description,
        displayName: body.displayName,
        encodedKubeconfig: authorization.encodedKubeconfig,
        instanceName: body.instanceName,
        namespace: authorization.namespace,
        templateName: body.templateName === "" ? undefined : body.templateName,
      })
    );
  } catch (error) {
    return (
      adoptionFailure(error) ??
      jsonError("Project persistence is unavailable.", 503)
    );
  }
}
