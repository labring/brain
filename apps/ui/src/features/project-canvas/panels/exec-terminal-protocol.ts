import { encodeRawKubeconfig } from "@workspace/api/credential-key";

interface ExecTerminalInitDescriptor {
  kind: "ap" | "db";
  name: string;
  namespace: string;
  projectId?: string;
}

export function buildExecTerminalInitMessage({
  descriptor,
  rawKubeconfig,
}: {
  descriptor: ExecTerminalInitDescriptor;
  rawKubeconfig: string;
}) {
  return {
    kind: descriptor.kind,
    kubeconfig: encodeRawKubeconfig(rawKubeconfig),
    name: descriptor.name,
    namespace: descriptor.namespace,
    ...(descriptor.projectId ? { projectId: descriptor.projectId } : {}),
    type: "init" as const,
  };
}
