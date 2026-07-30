"use client";

import { useAtomValue } from "jotai";
import { BrainModuleView } from "@/features/analytics/brain-module-view";
import { useProjectId } from "@/features/panes/use-project-id";
import { ProjectCanvasWorkbench } from "@/features/project-canvas/workbench/project-canvas-workbench";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

export default function ProjectIdPage() {
  const uid = useProjectId();
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  return (
    <>
      <BrainModuleView projectId={uid} viewName="project_dashboard" />
      <ProjectCanvasWorkbench
        kubeconfig={kubeconfig}
        namespace={namespace}
        projectId={uid}
      />
    </>
  );
}
