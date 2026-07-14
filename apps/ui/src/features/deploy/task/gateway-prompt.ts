import type { DeployTaskRow } from "./schema";

const SEALOS_TEMPLATE_PROJECT_OWNERSHIP_PROMPT_LINES = [
  "Do not add projectId under spec for Kubernetes native resources such as Deployment, Service, Ingress, StatefulSet, ConfigMap, Secret, or Job.",
  "Project ownership is applied later by Brain as metadata.labels.brain.io/project-id; the Devbox agent does not need to encode the project id in generated YAML.",
];

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

export function buildGatewayPrompt(task: DeployTaskRow): string {
  return [
    "You are running inside a SealAI deployment Devbox.",
    "Work in /home/devbox/project.",
    ...gatewaySourcePromptLines(task),
    "",
    "Run the sealos-deploy skill to completion:",
    "/sealos-deploy using /home/devbox/project as the deployment workspace.",
    "",
    "Proceed automatically through all phases without stopping to ask for confirmation or input.",
    "Do not replace the skill workflow with your own ad-hoc deployment format.",
    "If a build is required, read /home/devbox/project/.sealos/build-runtime.json and use its DevBox S3 contract to create the kaniko Job.",
    "Do not invent S3 endpoints or inline DevBox secret values; use the secretKeyRef from build-runtime.json.",
    "",
    "When complete, ensure these output files exist:",
    "- /home/devbox/project/.sealos/build-runtime.json when the source needs an image build",
    "- /home/devbox/project/.sealos/delivery-manifest.json",
    "- /home/devbox/project/.sealos/build-result.json",
    "- /home/devbox/project/.sealos/template/index.yaml",
    "",
    "The final YAML must be an app.sealos.io/v1 Template multi-document artifact, not a Brain AP YAML.",
    ...SEALOS_TEMPLATE_PROJECT_OWNERSHIP_PROMPT_LINES,
    'When the image build succeeds, write /home/devbox/project/.sealos/build-result.json with status "succeeded", image.image_ref, and image.digest.',
    'Use only these build-result status values: "succeeded", "failed", or "skipped".',
    'If the image build fails, write /home/devbox/project/.sealos/build-result.json with status "failed" and an actionable error field.',
    "Before ending, verify with: test -s /home/devbox/project/.sealos/delivery-manifest.json && test -s /home/devbox/project/.sealos/build-result.json && test -s /home/devbox/project/.sealos/template/index.yaml",
    "",
    `Namespace: ${task.namespace}`,
    task.prompt ? `User request: ${task.prompt}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGatewayRepairPrompt(task: DeployTaskRow): string {
  return [
    "The previous turn completed, but required Sealos deployment output files were missing or empty.",
    "Fix this now by running /sealos-deploy to completion in /home/devbox/project.",
    "Do not ask a question and do not stop after a prose answer.",
    "If a build is required, read /home/devbox/project/.sealos/build-runtime.json and use its DevBox S3 contract. Do not invent endpoints or inline DevBox secret values.",
    "Required files:",
    "- /home/devbox/project/.sealos/delivery-manifest.json",
    "- /home/devbox/project/.sealos/build-result.json",
    "- /home/devbox/project/.sealos/template/index.yaml",
    "The final YAML must be an app.sealos.io/v1 Template multi-document artifact, not a Brain AP YAML.",
    ...SEALOS_TEMPLATE_PROJECT_OWNERSHIP_PROMPT_LINES,
    'When the image build succeeds, write build-result.json with status "succeeded", image.image_ref, and image.digest.',
    'Use only these build-result status values: "succeeded", "failed", or "skipped".',
    'If deployment cannot succeed, write build-result.json with status "failed" and an actionable error field.',
    task.source.kind === "github"
      ? `Repository: ${task.source.repo.fullName}`
      : null,
    task.source.kind === "prompt"
      ? `Deployment request: ${task.source.text}`
      : null,
    task.prompt ? `User request: ${task.prompt}` : null,
    "Before ending, verify with: test -s /home/devbox/project/.sealos/delivery-manifest.json && test -s /home/devbox/project/.sealos/build-result.json && test -s /home/devbox/project/.sealos/template/index.yaml",
  ]
    .filter(Boolean)
    .join("\n");
}
