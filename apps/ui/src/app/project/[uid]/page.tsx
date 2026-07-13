"use client";

import { useAtomValue } from "jotai";
import { ProjectCanvasWorkbench } from "@/features/project-canvas/workbench/project-canvas-workbench";
import { useProjectId } from "@/features/project-route-state/use-project-id";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

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
