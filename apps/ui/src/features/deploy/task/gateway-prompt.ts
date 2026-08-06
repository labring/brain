import type { DeployTaskRow } from "./schema";

export type ManagedDeployResumeMode =
  | "initial"
  | "input-submitted"
  | "repair";

function gatewaySourcePromptLines(task: DeployTaskRow): string[] {
  switch (task.source.kind) {
    case "github":
      return [
        "The workspace contains the cloned GitHub repository.",
        `Repository: ${task.source.repo.fullName}`,
        `Branch: ${task.source.branch ?? "default"}`,
      ];
    case "prompt":
      return [
        "The workspace is empty except for the .sealos output directory.",
        "Create deployment artifacts from the natural-language deployment request.",
        `Deployment request: ${task.source.text}`,
      ];
    default:
      throw new Error(
        `AI runner does not support ${task.source.kind} deployments.`
      );
  }
}

export function buildManagedGatewayPrompt(input: {
  repairFindings?: readonly string[];
  resumeMode: ManagedDeployResumeMode;
  task: DeployTaskRow;
}): string {
  return [
    "You are the sole execution owner of this SealAI deployment. Brain is only the task control plane and final Workload Ready gate.",
    "Work in /home/devbox/project and run the sealos-deploy skill in managed mode.",
    `Resume mode: ${input.resumeMode}`,
    "Read task identity and limits only from SEALAI_DEPLOY_TASK_ID, SEALAI_DEPLOY_INSTANCE_NAME, SEALAI_PROJECT_ID, SEALAI_NAMESPACE, SEALAI_INPUTS_PATH, SEALAI_MAX_REPAIR_TURNS, and SEALAI_TURN_DEADLINE_AT. Do not enumerate the environment or read/print the control capability token. Never invent or change the allocated Project, namespace, or Instance identity.",
    "Use the injected kubeconfig directly. You own build, kubectl apply, observation, logs, diagnosis, repair, re-apply, and runtime verification. Brain will not execute Kubernetes mutations for you.",
    "This managed task is non-interactive and already authorizes Kubernetes mutations within the allocated namespace and deployment identity, including a delete that is strictly required for convergence. Do not pause for confirmation. Never delete unrelated resources, protected platform resources, PVCs, databases, or external data unless the deployment plan explicitly owns them and the repair cannot converge safely without it.",
    "Do not create control.json, inputs-required.json, turn-report.json, verify-report.json, or any file-based RPC signal.",
    "Generate the canonical Sealos Template at /home/devbox/project/.sealos/template/index.yaml, add the required Brain identity labels to resources and Pod templates, compute its lowercase SHA-256, then call the template_ready MCP tool with only sha256.",
    "If template_ready returns awaiting_user, stop this turn without applying resources. Brain will render the form from Template spec.inputs and resume this same Codex Thread after writing values to SEALAI_INPUTS_PATH.",
    "If template_ready returns continue, proceed autonomously. On input-submitted resume, read the fixed SEALAI_INPUTS_PATH and render those values before build/apply; never echo values into the prompt, tool arguments, logs, or persistent control artifacts.",
    input.resumeMode === "input-submitted"
      ? `Input revision: ${input.task.agentInputRevision + 1}. Read values only from SEALAI_INPUTS_PATH.`
      : null,
    "After apply, perform real readiness and runtime-truth checks yourself. If anything fails, inspect Pod status, Events, describe output, and logs; fix it, re-apply, and verify again within the injected repair and deadline limits.",
    input.repairFindings?.length
      ? `Brain final readiness findings from the previous turn: ${JSON.stringify(input.repairFindings.slice(0, 64))}`
      : null,
    "Only after your own deployment checks pass, call deployment_completed with exactly {}. If Brain returns repair, use its findings as evidence, diagnose and repair yourself, then call deployment_completed again. If Brain returns accepted_stop, end the turn successfully.",
    "The only Brain control tools you may call are template_ready and deployment_completed. Do not ask Brain to apply, patch, delete, exec, read logs, or debug.",
    input.resumeMode === "initial"
      ? "Start from the source repository and run /sealos-deploy to completion."
      : "Resume from the existing workspace and Thread. Preserve completed work and the allocated identity; do not restart source analysis.",
    "",
    ...gatewaySourcePromptLines(input.task),
    `Namespace: ${input.task.namespace}`,
    input.task.prompt ? `User request: ${input.task.prompt}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
