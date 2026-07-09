import type { DeploymentTaskRunner } from "./schema";

const GENERIC_FAILURE_MESSAGE = "Deployment task failed.";
const MAX_REASON_LENGTH = 200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Curated headlines for AI Runner failures whose raw stderr is too noisy to
 * show. Kept separate so the shared failure-reason path can reuse them while
 * `deployTaskFailureSummary` stays a stable `(error) => string`.
 */
function aiFailureHeadline(message: string): string | null {
  if (
    message.includes("No valid skills found") ||
    message.includes("Skills require a SKILL.md")
  ) {
    return "Deploy skill installation failed.";
  }
  if (message.includes("Timed out waiting for deploy Devbox runtime")) {
    return "Timed out waiting for deploy runtime.";
  }
  if (message.includes("BuildKit build could not start")) {
    return "BuildKit build could not start.";
  }
  if (message.includes("Codex gateway completed without deployment output")) {
    return "Codex gateway completed without deployment output.";
  }
  return null;
}

export function deployTaskFailureSummary(error: unknown): string {
  return aiFailureHeadline(errorMessage(error)) ?? GENERIC_FAILURE_MESSAGE;
}

/**
 * Whether a runner's terminal error may be surfaced raw in the timeline
 * (ADR 0042). "Scrub ⇔ raw display": only runners whose terminal error is
 * scrubbed of known sensitive values — the deterministic runners, whose
 * sensitive values are an enumerable set — surface the raw error and the
 * raw-first-line fallback. The AI Runner is excluded until its terminal
 * error string goes through gateway-style redaction (tracked separately).
 */
export function deployRunnerSurfacesRawFailure(runner: {
  kind: DeploymentTaskRunner["kind"];
}): boolean {
  return runner.kind === "template" || runner.kind === "direct";
}

/**
 * Reason codes a runner attaches to a failure that deserve a stable headline
 * over their raw message. These are fixed system verdicts, not raw echoes, so
 * they apply to every runner. Engine-resolved verdicts (interrupted, timeout,
 * cancelled) are written by the reaper with their own descriptive messages and
 * are not routed through here yet.
 */
const REASON_HEADLINES: Record<string, string> = {
  "readiness-timeout": "Deployment resources didn't become ready in time.",
};

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
  return REASON_HEADLINES[code] ?? null;
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
 * (ADR 0042), by precedence: a recognized failure-class headline, else the
 * first line of the (already scrubbed) ground-truth error for runners that
 * surface raw errors, else the generic string only when neither a reason nor
 * any error text exists.
 */
export function deploymentFailureReason(input: {
  rawMessage?: string | null;
  reasonCode?: string | null;
  surfacesRaw: boolean;
}): string {
  const message = input.rawMessage ?? "";
  // A reason-code or curated AI headline is a fixed label, not a raw echo, so
  // it applies to every runner.
  const fixedHeadline =
    reasonCodeHeadline(input.reasonCode) ?? aiFailureHeadline(message);
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
  return GENERIC_FAILURE_MESSAGE;
}
