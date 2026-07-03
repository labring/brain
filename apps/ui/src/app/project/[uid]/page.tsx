"use client";

import { useAtomValue } from "jotai";
import { useParams } from "next/navigation";
import { ProjectCanvasWorkbench } from "@/features/project-canvas/workbench/project-canvas-workbench";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

export default function ProjectIdPage() {
  const params = useParams<{ uid: string }>();
  const uid = decodeURIComponent(params.uid ?? "");
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
