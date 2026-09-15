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
 * first "leave" verdict therefore revalidates once and only acts if the
 * fresh list still lacks the Project — a real Project is never bounced by
 * a stale cache.
 */
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
  // The Project id whose absence a revalidation has confirmed.
  const [verifiedMissing, setVerifiedMissing] = useState<string | null>(null);

  useEffect(() => {
    if (decision !== "leave") {
      return;
    }
    if (verifiedMissing !== projectId) {
      let cancelled = false;
      refreshProjects()
        .catch(() => undefined)
        .then(() => {
          if (!cancelled) {
            setVerifiedMissing(projectId);
          }
        });
      return () => {
        cancelled = true;
      };
    }
    router.replace("/project");
    toast(PROJECT_NOT_IN_WORKSPACE_NOTICE);
  }, [decision, projectId, refreshProjects, router, verifiedMissing]);

  return null;
}
