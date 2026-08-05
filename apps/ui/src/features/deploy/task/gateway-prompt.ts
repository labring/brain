import type { DeployTaskRow } from "./schema";

export type ManagedDeployResumeMode =
  | "brain-review-rejected"
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
  resumeMode: ManagedDeployResumeMode;
  task: DeployTaskRow;
}): string {
  return [
    "You are the execution owner of an Agent-managed SealAI deployment turn. Brain only supervises task progress, bounded repair turns, and final availability verification.",
    "Work in /home/devbox/project and run the sealos-deploy skill in managed mode.",
    `Resume mode: ${input.resumeMode}`,
    "",
    "Before taking action, read all managed deployment state:",
    "- /home/devbox/project/.sealos/brain/control.json",
    "- /home/devbox/project/.sealos/brain/output-contract.json",
    "- existing files under /home/devbox/project/.sealos, including prior delivery and build artifacts",
    "- the input file referenced by SEALAI_INPUTS_PATH when that environment variable is set",
    "",
    "Treat control.json as authoritative for task identity, turn identity, namespace, allocated resource identity, and deadline.",
    "Treat output-contract.json as the complete output protocol. Write only its fixed file paths, copy its expectedEnvelope exactly, satisfy its JSON Schemas and semanticRules, and do not add unknown fields.",
    "You autonomously own every deployment operation inside the Devbox, including kubectl apply, patch, delete, exec, get, describe, and logs.",
    "Do not wait for mutation authorization or ask Brain to execute Kubernetes changes. Deploy, observe, diagnose, repair, re-apply, and verify the application yourself.",
    "If required user configuration is missing, write inputs-required.json and return the inputs-required outcome before performing any deployment mutation.",
    input.resumeMode === "initial"
      ? "Begin the managed deployment from the source while preserving the allocated identity from control.json."
      : "Preserve completed phases and existing deployment conclusions. Do not restart source analysis, allocate a different identity, or discard existing artifacts unless the managed skill determines they are invalid.",
    input.resumeMode === "initial"
      ? "Run /sealos-deploy to completion for this initial managed turn."
      : "Run /sealos-deploy managed resume to completion for this managed continuation turn.",
    "Do not replace the skill workflow with ad-hoc deployment commands or ask for input in the conversation.",
    "Before ending every turn, write /home/devbox/project/.sealos/brain/turn-report.json with the current taskId, turnId, outcome, diagnostics, and summary.",
    "Use exactly one turn outcome: inputs-required, applied, needs-repair, verified, or fatal. diagnostics is a required array and may be empty.",
    "For inputs-required, set inputsRequiredPath to .sealos/brain/inputs-required.json. For verified, set verifyReportPath to .sealos/brain/verify-report.json.",
    "When the outcome is verified, also write /home/devbox/project/.sealos/brain/verify-report.json with a complete list of deployed resources and the checks you performed.",
    "The verify report must repeat schemaVersion 1, taskId, and turnId; set verdict to passed only after real checks, and include artifacts, checks, resources, and summary.",
    "",
    ...gatewaySourcePromptLines(input.task),
    `Namespace: ${input.task.namespace}`,
    input.task.prompt ? `User request: ${input.task.prompt}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
