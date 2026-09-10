import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { deployTasks } from "@/features/deploy/task/schema";
import { getTemplateReadme } from "@/features/deploy/template-provider-core";
import { getProjectDb } from "@/lib/project-persistence/db";
import { getProject } from "@/lib/project-persistence/projects";
import { templateInstanceAdoptions } from "@/lib/project-persistence/schema";

export interface ProjectTemplateReadmeInput {
  encodedKubeconfig: string;
  language?: "en" | "zh";
  namespace: string;
  projectId: string;
  signal?: AbortSignal;
  templateName?: string;
}

const MAX_TEMPLATES = 100;

/** Read only template names, never deployment inputs or rendered manifests. */
export async function listProjectTemplateNames(input: {
  namespace: string;
  projectId: string;
}): Promise<string[]> {
  const db = getProjectDb();
  const name = sql<string>`${deployTasks.source}->>'templateName'`;
  const [tasks, adoptions] = await Promise.all([
    db
      .selectDistinct({ name })
      .from(deployTasks)
      .where(
        and(
          eq(deployTasks.namespace, input.namespace),
          eq(deployTasks.projectId, input.projectId),
          sql`${deployTasks.source}->>'kind' = 'template'`
        )
      )
      .orderBy(name)
      .limit(MAX_TEMPLATES + 1),
    db
      .selectDistinct({ name: templateInstanceAdoptions.templateName })
      .from(templateInstanceAdoptions)
      .where(
        and(
          eq(templateInstanceAdoptions.namespace, input.namespace),
          eq(templateInstanceAdoptions.projectId, input.projectId),
          eq(templateInstanceAdoptions.status, "adopted")
        )
      )
      .orderBy(templateInstanceAdoptions.templateName)
      .limit(MAX_TEMPLATES + 1),
  ]);
  return [
    ...new Set(
      [...tasks, ...adoptions]
        .map((row) => row.name?.trim())
        .filter((value): value is string => Boolean(value))
    ),
  ].sort();
}

interface ReadmeDependencies {
  listTemplateNames: typeof listProjectTemplateNames;
  readProject: typeof getProject;
  readReadme: typeof getTemplateReadme;
}

const dependencies: ReadmeDependencies = {
  readProject: getProject,
  listTemplateNames: listProjectTemplateNames,
  readReadme: getTemplateReadme,
};

export async function readProjectTemplateReadme(
  input: ProjectTemplateReadmeInput,
  deps: ReadmeDependencies = dependencies
) {
  const project = await deps.readProject(input.namespace, input.projectId);
  if (
    !project ||
    project.namespace !== input.namespace ||
    project.id !== input.projectId
  ) {
    return { ok: false as const, error: "Project README is unavailable." };
  }
  const names = await deps.listTemplateNames(input);
  const templates = [...new Set(names.filter(Boolean))].sort();
  if (templates.length === 0) {
    return {
      ok: false as const,
      error: "No Template is recorded for this Project.",
    };
  }
  if (templates.length > MAX_TEMPLATES) {
    return {
      ok: false as const,
      error: "This Project has too many Template sources to select reliably.",
    };
  }
  const selected =
    input.templateName ?? (templates.length === 1 ? templates[0] : undefined);
  if (!selected) {
    return {
      ok: false as const,
      templates,
      error:
        "Select the relevant templateName from this Project's recorded Templates, then call again.",
    };
  }
  if (!templates.includes(selected)) {
    return {
      ok: false as const,
      error: "Template is not recorded for this Project.",
    };
  }
  const readme = await deps.readReadme({
    encodedKubeconfig: input.encodedKubeconfig,
    language: input.language,
    signal: input.signal,
    templateName: selected,
  });
  if (!readme.content.trim()) {
    return {
      ok: false as const,
      error:
        "The Template provider has no README available. Continue with other tools.",
    };
  }
  return {
    ok: true as const,
    templateName: selected,
    ...readme,
    trust: "external-documentation" as const,
  };
}
