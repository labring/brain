"use client";

import { useAtomValue } from "jotai";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
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
 */
export function ProjectWorkspaceGuard() {
  const projectId = useProjectId();
  const router = useRouter();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom);
  const { devMockActive, projectsLoaded, states } =
    useProjectsExplorerReadModel({ kubeconfig, ns: namespace });
  const decision = devMockActive
    ? "stay"
    : projectWorkspaceGuardDecision({
        loaded: projectsLoaded,
        projectId,
        projectIds: states.projects.map((project) => project.id),
      });

  useEffect(() => {
    if (decision !== "leave") {
      return;
    }
    router.replace("/project");
    toast(PROJECT_NOT_IN_WORKSPACE_NOTICE);
  }, [decision, router]);

  return null;
}
