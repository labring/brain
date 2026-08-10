import type { DeployTaskRow } from "./schema";

export type ManagedDeployResumeMode = "initial" | "input-submitted" | "repair";

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
    "Read task identity and limits only from SEALAI_DEPLOY_TASK_ID, SEALAI_PROJECT_ID, SEALAI_DEPLOY_LABELS_JSON, SEALAI_NAMESPACE, SEALAI_INPUTS_PATH, and SEALAI_TURN_DEADLINE_AT. Do not enumerate the environment or read/print the control capability token. Brain owns the namespace; Sealos and the Skill own the actual Instance name.",
    "Use the injected kubeconfig directly. You own build, kubectl apply, observation, logs, diagnosis, repair, re-apply, and runtime verification. Brain will not execute Kubernetes mutations for you.",
    "This managed task is non-interactive and already authorizes Kubernetes mutations within the allocated namespace and deployment identity, including a delete that is strictly required for convergence. Do not pause for confirmation. Never delete unrelated resources, protected platform resources, PVCs, databases, or external data unless the deployment plan explicitly owns them and the repair cannot converge safely without it.",
    "Do not create control.json, inputs-required.json, turn-report.json, verify-report.json, or any file-based RPC signal.",
    "Generate the canonical Sealos Template at /home/devbox/project/.sealos/template/index.yaml, compute its lowercase SHA-256, then call the template_ready MCP tool with only sha256. The platform provides ownership labels through SEALAI_DEPLOY_LABELS_JSON; preserve them and let the sealos-deploy skill pass them to the Template API as extraLabels. Do not fabricate deployment-name or template-name labels, and do not use an Instance name supplied by Brain.",
    "If template_ready returns awaiting_user, stop this turn without applying resources. Brain will render the form from Template spec.inputs and resume this same Codex Thread after writing values to SEALAI_INPUTS_PATH.",
    "If template_ready returns continue, proceed autonomously. On input-submitted resume, and on any later repair turn when the file exists, have the deploy helper reuse the fixed SEALAI_INPUTS_PATH before build/apply; never echo values into the prompt, tool arguments, logs, or persistent control artifacts.",
    input.resumeMode === "input-submitted"
      ? `Input revision: ${input.task.agentInputRevision + 1}. Read values only from SEALAI_INPUTS_PATH.`
      : null,
    input.resumeMode === "repair"
      ? "This is an in-place repair of the deployment this task already created, not a new deployment. Use SEALAI_PROJECT_ID, the previous Template API result, existing .sealos state, and live project-labeled resources to identify the original Instance. Preserve its concrete app name, random suffix, public host, databases, PVCs, and other resource identities. If SEALAI_INPUTS_PATH exists, reuse it only through the deploy helper; do not ask for or invent replacement values. Do not call the raw Template API to create another Instance, restart the fresh DEPLOY pipeline, or re-evaluate identity-bearing random() defaults. Rebuild images and use kubectl apply, patch, or rollout operations to converge the existing resources. If you cannot identify exactly one original deployment, keep diagnosing and fail this task rather than create a replacement deployment."
      : null,
    "After apply, perform real readiness and runtime-truth checks yourself. If anything fails, inspect Pod status, Events, describe output, and logs; fix it, re-apply, and verify again as many times as needed. The single hard limit is SEALAI_TURN_DEADLINE_AT; there is no per-turn or per-repair limit.",
    input.repairFindings?.length
      ? `Brain final readiness findings from the previous turn: ${JSON.stringify(input.repairFindings.slice(0, 64))}`
      : null,
    "Only after your own deployment checks pass, call deployment_completed with the actual workload resource references you just deployed (apiVersion, kind, name, namespace). When the deployment exposes a public URL, include it as publicUrl. Brain treats the references only as lookup targets, performs a small Ready check, and probes publicUrl for a 2xx response when provided. If Brain returns repair, use its findings as evidence, diagnose and repair yourself, then call deployment_completed again. If Brain returns accepted_stop, end the turn successfully.",
    "The only Brain control tools you may call are template_ready and deployment_completed. Do not ask Brain to apply, patch, delete, exec, read logs, or debug.",
    input.resumeMode === "initial"
      ? "Start from the source repository and run /sealos-deploy to completion."
      : "Resume from the existing workspace and Thread. Preserve completed work and the actual resources already created; do not restart source analysis.",
    "",
    ...gatewaySourcePromptLines(input.task),
    `Namespace: ${input.task.namespace}`,
    input.task.prompt ? `User request: ${input.task.prompt}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
