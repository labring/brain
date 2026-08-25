import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeAssistantNamespace } from "@/features/chat/persistence/types";
import {
  adoptLegacyGithubConnectionForOwner,
  getGithubConnectionStatusForOwner,
} from "@/features/deploy/github/connection-service";
import { verifiedGithubConnectionActor } from "@/features/deploy/github/owner-identity";
import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/features/deploy/task/api-auth";
import { createDeployTaskAction } from "@/features/deploy/task/engine/actions";
import { getDeployTaskEngineContext } from "@/features/deploy/task/engine/server";
import {
  resolveDeployTaskTargetForCreate,
  runDeployTask,
} from "@/features/deploy/task/runner";
import {
  CURRENT_DEPLOYMENT_CREDENTIAL_BINDING_VERSION,
  type DeploymentCredentialBinding,
  type DeploymentTaskSource,
  type DeployTaskRow,
} from "@/features/deploy/task/schema";
import {
  getDeployTaskByIdInNamespace,
  listDeploymentTaskProjections,
  listDeployTasks,
  toDeployTaskDTO,
} from "@/features/deploy/task/service";
import {
  createDeployTaskInputSchema,
  deployTaskStatusSchema,
} from "@/features/deploy/task/types";
import { marketingAttributionSnapshotSchema } from "@/features/marketing/types";
import { appTokenFromRequest } from "@/lib/app-token";
import { IdentityBindingSupersededError } from "@/lib/identity-fingerprint-core";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = createDeployTaskInputSchema
  .omit({ createdFrom: true, marketingAttribution: true })
  .partial({ runner: true, source: true, target: true })
  .extend({
    encodedKubeconfig: z.string().optional(),
    /**
     * Validated separately after parsing: a malformed attribution snapshot
     * degrades to an unattributed deploy instead of rejecting the request.
     */
    marketingAttribution: z.unknown().optional(),
    /** Redeploy: clone this failed/cancelled predecessor (ADR 0038). */
    predecessorTaskId: z.string().trim().min(1).max(128).optional(),
  })
  .refine(
    (value) =>
      value.predecessorTaskId != null ||
      (value.runner != null && value.source != null && value.target != null),
    {
      message: "source, target, and runner are required without a predecessor",
    }
  );

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json(
    { ...(code == null ? {} : { code }), error: message },
    { status }
  );
}

function identityBindingFailureResponse(error: unknown): NextResponse {
  if (error instanceof IdentityBindingSupersededError) {
    return jsonError(
      "Authentication is required.",
      401,
      "app_token_superseded"
    );
  }
  throw error;
}

/**
 * Marketing attribution needs the same app-token identity binding as GitHub
 * credentials. The regional workspace actor remains the deployment actor;
 * the verified global uid is passed to the marketing normalizer separately.
 */
async function resolveCredentialBinding(input: {
  appToken: string;
  encodedKubeconfig?: string;
  namespace: string;
  requiresMarketingIdentity: boolean;
  sourceKind?: DeploymentTaskSource["kind"];
}): Promise<
  | {
      credentialBinding?: DeploymentCredentialBinding;
      marketingConsentSubject?: string;
    }
  | { response: NextResponse }
> {
  if (input.sourceKind !== "github" && !input.requiresMarketingIdentity) {
    return {};
  }
  const authorization = await authorizeWorkspaceActor({
    appToken: input.appToken,
    encodedKubeconfig: input.encodedKubeconfig,
    expectedNamespace: input.namespace,
    normalizeNamespace: normalizeAssistantNamespace,
  });
  if (!authorization.ok) {
    // Marketing identity is best-effort for namespace-shared sources: an
    // unverifiable actor (missing or stale app token) degrades to an
    // unattributed user — the normalizer scrubs unverified consent — instead
    // of blocking the deploy. GitHub stays fail-closed: it needs the actor
    // for credentials, not just attribution.
    if (input.sourceKind !== "github") {
      return {};
    }
    return {
      response: jsonError(
        authorization.message,
        authorization.status,
        authorization.code
      ),
    };
  }
  const marketingConsentSubject = authorization.actorBinding.userUid;
  if (input.sourceKind !== "github") {
    return { marketingConsentSubject };
  }
  const actor = verifiedGithubConnectionActor(authorization);
  // Every verified entry request first adopts the initiator's legacy
  // generation-1 crName row into the uid owner (lazy re-key, ADR-0059).
  try {
    await adoptLegacyGithubConnectionForOwner(actor);
  } catch (error) {
    if (error instanceof IdentityBindingSupersededError) {
      return {
        response: jsonError(
          "Authentication is required.",
          401,
          "app_token_superseded"
        ),
      };
    }
    throw error;
  }
  const connection = await getGithubConnectionStatusForOwner(actor.owner);
  if (connection == null) {
    return {
      response: jsonError(
        "Connect GitHub before creating this deployment task.",
        409,
        "github_connection_required"
      ),
    };
  }
  return {
    credentialBinding: {
      connectionRef: connection.id,
      credentialOwner: actor.owner.userUid,
      version: CURRENT_DEPLOYMENT_CREDENTIAL_BINDING_VERSION,
    },
    marketingConsentSubject,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = deployTaskRequestParams(request);
  const namespaceResolved = await resolveDeployTaskRequestNamespace({
    clientNamespace: params.namespace,
    encodedKubeconfig: params.encodedKubeconfig,
  });
  if (!namespaceResolved.ok) {
    return jsonError(
      namespaceResolved.message ?? "Invalid deploy task namespace",
      namespaceResolved.status ?? 400
    );
  }
  if (namespaceResolved.namespace == null) {
    return jsonError("Invalid deploy task namespace", 400);
  }

  if (url.searchParams.get("view") === "tasks") {
    const statusParams = url.searchParams
      .getAll("status")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter((value) => value !== "");
    const statuses = statusParams.flatMap((value) => {
      const parsed = deployTaskStatusSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
    if (statuses.length !== statusParams.length) {
      return jsonError("Invalid deploy task status filter", 400);
    }
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam == null ? undefined : Number(limitParam);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      return jsonError("Invalid deploy task list limit", 400);
    }
    const result = await listDeployTasks({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit,
      namespace: namespaceResolved.namespace,
      projectId: url.searchParams.get("projectId")?.trim() || undefined,
      status: statuses.length === 0 ? undefined : statuses,
    });
    return NextResponse.json(result);
  }

  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ projections: [] });
  }
  const projections = await listDeploymentTaskProjections({
    namespace: namespaceResolved.namespace,
    projectId,
  });
  return NextResponse.json({ projections });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid deploy task request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const namespaceResolved = await resolveDeployTaskRequestNamespace({
    encodedKubeconfig: parsed.data.encodedKubeconfig,
    clientNamespace: parsed.data.namespace,
  });
  if (!namespaceResolved.ok) {
    return jsonError(
      namespaceResolved.message ?? "Invalid deploy task namespace",
      namespaceResolved.status ?? 400
    );
  }
  const taskNamespace = namespaceResolved.namespace ?? parsed.data.namespace;
  let predecessor: DeployTaskRow | null = null;
  if (parsed.data.predecessorTaskId != null) {
    predecessor = await getDeployTaskByIdInNamespace(
      parsed.data.predecessorTaskId,
      taskNamespace
    );
    if (predecessor == null) {
      return jsonError("Deploy task predecessor not found", 404);
    }
  }
  const effectiveSource = parsed.data.source ?? predecessor?.source;
  const creatingActor = namespaceResolved.workspaceActor;
  // Attribution never blocks a deploy: a snapshot that fails validation is
  // dropped here and the task proceeds unattributed.
  const attributionParse =
    parsed.data.marketingAttribution == null
      ? null
      : marketingAttributionSnapshotSchema.safeParse(
          parsed.data.marketingAttribution
        );
  const marketingAttribution = attributionParse?.success
    ? attributionParse.data
    : undefined;
  const bindingResolution = await resolveCredentialBinding({
    appToken: appTokenFromRequest(request),
    encodedKubeconfig: parsed.data.encodedKubeconfig,
    namespace: taskNamespace,
    requiresMarketingIdentity: marketingAttribution?.consent_token != null,
    sourceKind: effectiveSource?.kind,
  });
  if ("response" in bindingResolution) {
    return bindingResolution.response;
  }
  const { credentialBinding, marketingConsentSubject } = bindingResolution;

  const {
    encodedKubeconfig,
    marketingAttribution: _rawMarketingAttribution,
    predecessorTaskId,
    ...taskInput
  } = parsed.data;
  let result: Awaited<ReturnType<typeof createDeployTaskAction>>;
  try {
    result = await createDeployTaskAction(getDeployTaskEngineContext(), {
      create: {
        ...taskInput,
        createdFrom: "ui",
        ...(creatingActor == null ? {} : { creatingActor }),
        ...(credentialBinding == null ? {} : { credentialBinding }),
        ...(marketingAttribution == null ? {} : { marketingAttribution }),
        ...(marketingConsentSubject == null ? {} : { marketingConsentSubject }),
        namespace: taskNamespace,
      },
      predecessorTaskId,
      resolveTarget: resolveDeployTaskTargetForCreate,
      run: (handle, task) =>
        runDeployTask(handle, {
          encodedKubeconfig,
          // Full template args from the request body: the engine persists a
          // stripped copy, so sensitive values reach the runner only through
          // this in-memory hand-off (ADR 0037).
          sourceArgValues:
            parsed.data.source?.kind === "template"
              ? parsed.data.source.args
              : undefined,
          taskId: task.id,
        }),
    });
  } catch (error) {
    return identityBindingFailureResponse(error);
  }

  switch (result.kind) {
    case "created":
      return NextResponse.json(
        { task: toDeployTaskDTO(result.task) },
        { status: 201 }
      );
    case "invalid":
      return jsonError(result.message, 400);
    case "predecessor-not-found":
      return jsonError("Deploy task predecessor not found", 404);
    case "project-name-conflict":
      // Only a caller-chosen name reaches here; derived names resolve their own
      // collisions with a suffix (ADR 0058).
      return jsonError(
        `A project named "${result.displayName}" already exists.`,
        409,
        "project_name_conflict"
      );
    case "predecessor-conflict":
      return NextResponse.json(
        {
          error: "Deploy task predecessor is not failed or cancelled.",
          task: toDeployTaskDTO(result.predecessor),
        },
        { status: 409 }
      );
    case "clone-conflict":
      return NextResponse.json(
        {
          error: "A recovery attempt for this deployment is already active.",
          ...(result.activeClone == null
            ? {}
            : { task: toDeployTaskDTO(result.activeClone) }),
        },
        { status: 409 }
      );
    default:
      return result satisfies never;
  }
}
