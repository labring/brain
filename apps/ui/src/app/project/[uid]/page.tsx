"use client";

import { useAtomValue } from "jotai";
import { useProjectId } from "@/features/panes/use-project-id";
import { ProjectCanvasWorkbench } from "@/features/project-canvas/workbench/project-canvas-workbench";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

export default function ProjectIdPage() {
  const uid = useProjectId();
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  return (
    <ProjectCanvasWorkbench
      kubeconfig={kubeconfig}
      namespace={namespace}
      projectId={uid}
    />
  );
}
