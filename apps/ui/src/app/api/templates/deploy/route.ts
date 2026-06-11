import { NextResponse } from "next/server";
import { z } from "zod";

import { getProject } from "@/lib/project-persistence/projects";
import {
  devCredentialsFromEnv,
  hasDevCredentialBypass,
} from "@/lib/server-credentials";
import { deployTemplateInstance } from "@/lib/template-provider-core";
import { authorizeTemplateDeployIdentity } from "./auth";
import { templateDeploymentExtraLabels } from "./labels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  args: z.record(z.string(), z.string()).optional(),
  encodedKubeconfig: z.string().min(1),
  instanceName: z.string().trim().min(1).max(63),
  namespace: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  projectName: z.string().trim().min(1),
  templateName: z.string().trim().min(1),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function authorizeTemplateDeploy(input: {
  encodedKubeconfig: string;
  namespace: string;
  projectId: string;
}): Promise<
  | { denied: null; encodedKubeconfig: string }
  | { denied: Response; encodedKubeconfig?: never }
> {
  if (hasDevCredentialBypass()) {
    const dev = devCredentialsFromEnv();
    const project = await getProject(input.namespace, input.projectId);
    const authorization = authorizeTemplateDeployIdentity({
      devBypass: true,
      devEncodedKubeconfig: dev.encodedKubeconfig,
      devNamespace: dev.namespace,
      encodedKubeconfig: input.encodedKubeconfig,
      namespace: input.namespace,
      project,
      serverCredentials: {
        serverEncodedKubeconfig: "",
        serverNamespace: "",
      },
    });
    return authorization.ok
      ? { denied: null, encodedKubeconfig: authorization.encodedKubeconfig }
      : { denied: jsonError(authorization.message, authorization.status) };
  }

  const project = await getProject(input.namespace, input.projectId);
  const authorization = authorizeTemplateDeployIdentity({
    devBypass: false,
    devEncodedKubeconfig: "",
    devNamespace: "",
    encodedKubeconfig: input.encodedKubeconfig,
    namespace: input.namespace,
    project,
    serverCredentials: {
      serverEncodedKubeconfig: "",
      serverNamespace: "",
    },
  });
  return authorization.ok
    ? { denied: null, encodedKubeconfig: authorization.encodedKubeconfig }
    : { denied: jsonError(authorization.message, authorization.status) };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid template deploy request.",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  try {
    const authorization = await authorizeTemplateDeploy({
      encodedKubeconfig: parsed.data.encodedKubeconfig,
      namespace: parsed.data.namespace,
      projectId: parsed.data.projectId,
    });
    if (authorization.denied !== null) {
      return authorization.denied;
    }
    const deployed = await deployTemplateInstance({
      args: parsed.data.args,
      encodedKubeconfig: authorization.encodedKubeconfig,
      extraLabels: templateDeploymentExtraLabels({
        projectId: parsed.data.projectId,
        templateName: parsed.data.templateName,
      }),
      instanceName: parsed.data.instanceName,
      templateName: parsed.data.templateName,
    });
    return NextResponse.json({
      instanceName: deployed.instanceName,
      resources: deployed.resources,
    });
  } catch (error) {
    console.error("[templates] deploy failed", error);
    return jsonError(
      error instanceof Error ? error.message : "Could not deploy template.",
      500
    );
  }
}
