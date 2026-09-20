"use client";

import { useAtomValue } from "jotai";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useProjectId } from "@/features/panes/use-project-id";
import { useProjectsExplorerReadModel } from "@/features/projects/explorer/use-projects-explorer";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

import { projectWorkspaceGuardDecision } from "./project-workspace-guard-core";

export const PROJECT_NOT_IN_WORKSPACE_NOTICE =
  "That Project is not in the current Workspace.";

/**
 * The `/project/<uid>` guard (spec §H.2): once the current Workspace's
 * Project list is loaded and lacks the Project in the URL, replace the
 * route with the Project list and say so. Renders nothing. The Projects
 * Dev Mock's fixture rows are not real Projects, so the guard stands down
 * while it is on.
 *
 * The list is an SWR cache that does not revalidate on focus, so a Project
 * created in another tab is absent from it until something refreshes. A
 * first "leave" verdict therefore revalidates once and only acts when the
 * revalidation's *payload* came back as a list that still lacks the
 * Project — a real Project is never bounced by a stale cache or by a
 * rendered snapshot that has not painted yet, and a refresh that failed
 * (401, 5xx, offline) or answered an unusable shape confirms nothing, so
 * the guard keeps standing rather than judging from the stale verdict.
 */
/**
 * The revalidation's payload — the raw `/api/projects` answer — or null
 * when it did not come back as a usable list. The guard judges only the
 * payload: the hook's rendered snapshot may not have painted yet.
 */
function freshProjectIdsOf(fresh: unknown): string[] | null {
  if (typeof fresh !== "object" || fresh == null) {
    return null;
  }
  const projects = (fresh as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) {
    return null;
  }
  const ids: string[] = [];
  for (const project of projects) {
    if (
      typeof project !== "object" ||
      project == null ||
      !("id" in project) ||
      typeof (project as { id: unknown }).id !== "string"
    ) {
      return null;
    }
    ids.push((project as { id: string }).id);
  }
  return ids;
}

export function ProjectWorkspaceGuard() {
  const projectId = useProjectId();
  const router = useRouter();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom);
  const { devMockActive, projectsLoaded, refreshProjects, states } =
    useProjectsExplorerReadModel({ kubeconfig, ns: namespace });
  const decision = devMockActive
    ? "stay"
    : projectWorkspaceGuardDecision({
        loaded: projectsLoaded,
        projectId,
        projectIds: states.projects.map((project) => project.id),
      });
  // The Project id whose absence a completed revalidation has re-judged.
  const [revalidatedFor, setRevalidatedFor] = useState<string | null>(null);

  useEffect(() => {
    if (decision !== "leave") {
      setRevalidatedFor((current) => (current == null ? current : null));
      return;
    }
    if (revalidatedFor === projectId) {
      router.replace("/project");
      toast(PROJECT_NOT_IN_WORKSPACE_NOTICE);
      return;
    }
    let cancelled = false;
    refreshProjects()
      .then((fresh) => {
        if (cancelled) {
          return;
        }
        const freshIds = freshProjectIdsOf(fresh);
        // Only a payload that came back as a list may confirm the verdict;
        // one that carries the Project stays the guard's hand until the
        // rendered snapshot flips the decision.
        if (freshIds == null || freshIds.includes(projectId)) {
          return;
        }
        setRevalidatedFor(projectId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [decision, projectId, refreshProjects, revalidatedFor, router]);

  return null;
}
