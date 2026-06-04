import type { AssistantContextPayload } from "@/lib/chat-persistence/types";

/**
 * Human-readable snippet appended to the model system prompt with project / workload
 * context supplied by the client (informational — not authoritative for cluster state).
 */
export function buildAssistantWorkspaceContextPrompt(opts: {
  kubernetesNamespace: string;
  assistantContext?: AssistantContextPayload;
}): string {
  const { kubernetesNamespace, assistantContext } = opts;
  const ns = kubernetesNamespace.trim();
  const projectName = assistantContext?.projectName?.trim() ?? "";
  const uid = assistantContext?.projectId?.trim() ?? "";

  const lines: string[] = [
    "## Current workspace (Seal UI)",
    ns === ""
      ? "- Primary Kubernetes namespace for this chat session: (not specified)"
      : `- Primary Kubernetes namespace for this chat session (thread bucket): \`${escapeBackticks(ns)}\``,
  ];

  if (uid !== "") {
    if (projectName !== "") {
      lines.push(`- Project display name: \`${escapeBackticks(projectName)}\``);
    }
    lines.push(`- Brain Project ID: \`${escapeBackticks(uid)}\``);
  }

  const wl = assistantContext?.selectedWorkload;
  if (wl != null) {
    lines.push("", "### Selected workload in the canvas / URL");
    if (wl.kubernetesUid != null && wl.kubernetesUid !== "") {
      lines.push(
        `- Kubernetes \`metadata.uid\`: \`${escapeBackticks(wl.kubernetesUid)}\``
      );
    }
    if (wl.name != null && wl.name.trim() !== "") {
      lines.push(
        `- Resource name / AP-bound target: \`${escapeBackticks(wl.name)}\``
      );
    }
    if (wl.namespace != null && wl.namespace.trim() !== "") {
      lines.push(`- Namespace: \`${escapeBackticks(wl.namespace)}\``);
    }
    if (wl.kind != null && wl.kind.trim() !== "") {
      lines.push(`- Kind hint: \`${escapeBackticks(wl.kind)}\``);
    }
  }

  lines.push("");
  lines.push(
    "The user sees this workspace in the product UI (canvas, namespace, selection). Prefer this context when answering about “this project” or “the selected service”. Use tools when you need authoritative cluster state."
  );

  return lines.join("\n");
}

function escapeBackticks(s: string): string {
  return s.replaceAll("`", "\\`");
}
