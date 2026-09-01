import type { DeploymentTaskRunner, DeployTaskFailureReason } from "./schema";

const UNKNOWN_FAILURE_MESSAGE =
  "Deployment failed for an unknown reason. Copy the Task ID and contact support.";
const MAX_REASON_LENGTH = 200;

const FAILURE_MESSAGES = {
  "github-authentication":
    "GitHub authorization is unavailable. Reconnect GitHub, then redeploy.",
  "repository-clone-failed":
    "The repository could not be cloned. Check repository access and the selected branch, then redeploy.",
  "deploy-configuration-invalid":
    "Deployment analysis is not configured correctly. Contact support.",
  "ai-proxy-unavailable":
    "Deployment analysis credentials could not be prepared. Redeploy; if the problem continues, contact support.",
  "deploy-runtime-unavailable":
    "The deployment workspace did not become ready. Redeploy; if the problem continues, contact support.",
  "build-runtime-unavailable":
    "The deployment workspace does not expose the required build service. Redeploy; if the problem continues, contact support.",
  "deploy-skill-install-failed":
    "Deploy skill installation failed. Redeploy; if the problem continues, contact support.",
  "buildkit-start-failed":
    "BuildKit could not start. Redeploy; if the problem continues, contact support.",
  "image-build-failed":
    "The application image could not be built. Check the repository build configuration, then redeploy.",
  "gateway-not-exposed":
    "The workspace did not expose the deployment analysis service. Redeploy; if the problem continues, contact support.",
  "gateway-unavailable":
    "The deployment analysis service is unavailable. Redeploy in a few minutes.",
  "gateway-upstream-error":
    "The deployment analysis service returned an error. Redeploy in a few minutes.",
  "gateway-timeout": "Repository analysis timed out. Redeploy to try again.",
  "deployment-output-missing":
    "Repository analysis finished without a deployable result. Redeploy; if the problem continues, contact support.",
  "template-output-invalid":
    "Repository analysis generated an invalid deployment template. Redeploy to generate a new template.",
  "apply-failed":
    "Generated resources could not be applied. Review the error details, then redeploy.",
  "quota-exceeded":
    "The namespace does not have enough quota for this deployment. Free resources or increase quota, then redeploy.",
  "balance-exhausted":
    "Deployment stopped — the account balance is exhausted and the workspace is suspended. Top up, then redeploy.",
  "readiness-timeout":
    "Deployment resources didn't become ready in time. Created resources were preserved — Redeploy reuses them.",
  interrupted:
    "Deployment was interrupted by the platform. Redeploy to continue.",
  timeout:
    "Deployment exceeded the maximum run time. Redeploy; if the problem continues, contact support.",
  "never-started":
    "Deployment could not start. Redeploy; if the problem continues, contact support.",
  "runner-error":
    "Deployment stopped because of an internal error. Copy the Task ID and contact support.",
  cancelled: "Deployment was cancelled.",
  unknown: UNKNOWN_FAILURE_MESSAGE,
} as const satisfies Record<DeployTaskFailureReason, string>;

const FAILURE_REASONS = new Set<DeployTaskFailureReason>(
  Object.keys(FAILURE_MESSAGES) as DeployTaskFailureReason[]
);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Maps recognizable legacy AI errors to stable failure reason codes. */
export function aiFailureReason(
  message: string
): DeployTaskFailureReason | null {
  if (
    message.includes("No valid skills found") ||
    message.includes("Skills require a SKILL.md")
  ) {
    return "deploy-skill-install-failed";
  }
  if (message.includes("Timed out waiting for deploy Devbox runtime")) {
    return "deploy-runtime-unavailable";
  }
  if (message.includes("BuildKit build could not start")) {
    return "buildkit-start-failed";
  }
  if (message.includes("Codex gateway completed without deployment output")) {
    return "deployment-output-missing";
  }
  if (
    message.includes("Sealos template header is not valid YAML.") ||
    message.includes("Rendered Sealos template is not valid YAML.") ||
    message.includes("Generated Sealos template declaration is invalid")
  ) {
    return "template-output-invalid";
  }
  return null;
}

export function deployTaskFailureSummary(error: unknown): string {
  const reason = aiFailureReason(errorMessage(error)) ?? "unknown";
  return deploymentFailureMessage(reason);
}

export function isDeployTaskFailureReason(
  value: unknown
): value is DeployTaskFailureReason {
  return (
    typeof value === "string" &&
    FAILURE_REASONS.has(value as DeployTaskFailureReason)
  );
}

export function deploymentFailureMessage(
  reason: DeployTaskFailureReason
): string {
  return FAILURE_MESSAGES[reason];
}

/**
 * The short reason a Deployment Task Dock chip carries beside its red dot
 * (design spec rows E1/E2): only the money and quota walls earn one; every
 * other failure keeps the plain dot.
 */
export function deploymentFailureChipPhrase(
  reason: DeployTaskFailureReason | null | undefined
): string | null {
  switch (reason) {
    case "balance-exhausted":
      return "out of balance";
    case "quota-exceeded":
      return "quota full";
    default:
      return null;
  }
}

/**
 * Whether a runner's terminal error may be surfaced raw in the timeline
 * (ADR 0042). "Scrub ⇔ raw display": only runners whose terminal error is
 * scrubbed of known sensitive values — the deterministic runners, whose
 * sensitive values are an enumerable set — surface the raw error and the
 * raw-first-line fallback. The AI Runner is excluded because arbitrary
 * Gateway, repository, and generated text has no complete redaction contract;
 * it exposes only allowlisted structured failure details.
 */
export function deployRunnerSurfacesRawFailure(runner: {
  kind: DeploymentTaskRunner["kind"];
}): boolean {
  return runner.kind === "template" || runner.kind === "direct";
}

/**
 * Substring-matched failure classes, applied ONLY to runners that surface the
 * raw error (ADR 0042): the raw error corrects a wrong class guess, and the AI
 * runner — which has no raw safety net — must never be given a class label a
 * false-positive substring produced.
 */
const KNOWN_FAILURE_HEADLINES: { headline: string; match: RegExp }[] = [
  { headline: "Namespace resource quota exceeded.", match: /exceeded quota/i },
  {
    headline: "A resource with this name already exists.",
    match: /already exists/i,
  },
  {
    headline: "The deployment values were rejected as invalid.",
    match: /invalid value|is invalid/i,
  },
  {
    headline: "Couldn't reach the deployment service.",
    match:
      /econnrefused|enotfound|etimedout|fetch failed|getaddrinfo|network error/i,
  },
];

function reasonCodeHeadline(
  reasonCode: string | null | undefined
): string | null {
  const code = reasonCode?.trim();
  if (code == null || code === "") {
    return null;
  }
  return isDeployTaskFailureReason(code)
    ? deploymentFailureMessage(code)
    : null;
}

function classFailureHeadline(message: string): string | null {
  for (const entry of KNOWN_FAILURE_HEADLINES) {
    if (entry.match.test(message)) {
      return entry.headline;
    }
  }
  return null;
}

function firstLine(text: string): string {
  const line = (text.split("\n")[0] ?? "").trim();
  if (line.length <= MAX_REASON_LENGTH) {
    return line;
  }
  return `${line.slice(0, MAX_REASON_LENGTH - 1)}…`;
}

/**
 * The user-facing Deployment Failure Reason shown on the failed timeline step
 * (ADR 0042), by precedence: a validated reason code or recognizable legacy AI
 * error; then, only for runners that surface scrubbed raw errors, a recognized
 * failure class or the raw first line; otherwise the generic support message.
 */
export function deploymentFailureReason(input: {
  rawMessage?: string | null;
  reasonCode?: string | null;
  surfacesRaw: boolean;
}): string {
  const message = input.rawMessage ?? "";
  // A reason-code or curated AI headline is a fixed label, not a raw echo, so
  // it applies to every runner.
  const aiReason = aiFailureReason(message);
  const fixedHeadline =
    reasonCodeHeadline(input.reasonCode) ??
    (aiReason == null ? null : deploymentFailureMessage(aiReason));
  if (fixedHeadline != null) {
    return fixedHeadline;
  }
  // Substring-class headlines and the raw first-line fallback apply only to
  // runners whose error is scrubbed and surfaced (ADR 0042 "scrub ⇔ raw
  // display"): the raw error corrects a wrong class guess, and the AI runner
  // has no such safety net.
  if (input.surfacesRaw) {
    const classHeadline = classFailureHeadline(message);
    if (classHeadline != null) {
      return classHeadline;
    }
    const raw = message.trim();
    if (raw !== "") {
      return firstLine(raw);
    }
  }
  return UNKNOWN_FAILURE_MESSAGE;
}
