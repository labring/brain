import { Buffer } from "node:buffer";
import { posix as path } from "node:path";
import { z } from "zod";

export const MANAGED_DEPLOYMENT_CONTRACT_VERSION = 1 as const;
export const MANAGED_CONTROL_MAX_BYTES = 64 * 1024;
export const MANAGED_INPUTS_REQUIRED_MAX_BYTES = 64 * 1024;
export const MANAGED_TURN_REPORT_MAX_BYTES = 256 * 1024;
export const MANAGED_VERIFY_REPORT_MAX_BYTES = 256 * 1024;
export const MANAGED_INPUT_VALUES_MAX_BYTES = 64 * 1024;

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
const DNS_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/;
const FIELD_MANAGER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SENSITIVE_INPUT_KEY_PATTERN =
  /(?:^|[_-])(?:ACCESS_KEY|API_KEY|CLIENT_SECRET|PASSWORD|PASSWD|PRIVATE_KEY|SECRET|TOKEN)(?:$|[_-])/i;
const CONTRACT_RELATIVE_PATH_PATTERN =
  /^\.sealos\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\r\n]+$/;

const taskIdSchema = z.string().min(1).max(128).regex(TASK_ID_PATTERN);
const turnIdSchema = z.number().int().nonnegative().max(1000);
const namespaceSchema = z.string().min(1).max(63).regex(DNS_LABEL_PATTERN);
const resourceNameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(DNS_SUBDOMAIN_PATTERN);
const normalizedAbsolutePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.includes("\0") &&
      !value.includes("\n") &&
      !value.includes("\r") &&
      path.normalize(value) === value,
    "Path must be a normalized absolute path."
  );
const contractRelativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(CONTRACT_RELATIVE_PATH_PATTERN);

const envelopeSchema = z.object({
  schemaVersion: z.literal(MANAGED_DEPLOYMENT_CONTRACT_VERSION),
  taskId: taskIdSchema,
  turnId: turnIdSchema,
});

export const managedResourceRefSchema = z
  .object({
    apiVersion: z.string().trim().min(1).max(128),
    kind: z.string().trim().min(1).max(128),
    name: resourceNameSchema,
    namespace: namespaceSchema,
    uid: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export const managedDeploymentControlSchema = envelopeSchema
  .extend({
    brainReviewPath: contractRelativePathSchema.optional(),
    deadlineAt: z.string().datetime({ offset: true }),
    fieldManager: z.string().min(1).max(128).regex(FIELD_MANAGER_PATTERN),
    identity: z
      .object({
        instanceName: resourceNameSchema,
        namespace: namespaceSchema,
        projectId: z.string().trim().min(1).max(256),
      })
      .strict(),
    inputsPath: normalizedAbsolutePathSchema.optional(),
    maxMutatedResourcesPerTurn: z.number().int().min(1).max(512),
    maxRepairTurns: z.number().int().nonnegative().max(10),
    mode: z.literal("brain-managed"),
    mutationAuthorizationPath: contractRelativePathSchema,
    mutationAuthorizationRequired: z.boolean(),
    mutationIntentPath: contractRelativePathSchema,
    previousTurnId: turnIdSchema.optional(),
    repairTurn: z.number().int().nonnegative().max(10),
    resumeMode: z.enum([
      "initial",
      "input-submitted",
      "repair",
      "brain-review-rejected",
    ]),
  })
  .strict()
  .superRefine((control, context) => {
    if (
      control.resumeMode === "brain-review-rejected" &&
      control.brainReviewPath === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "brain-review-rejected control requires brainReviewPath",
        path: ["brainReviewPath"],
      });
    }
    if (control.repairTurn > control.maxRepairTurns) {
      context.addIssue({
        code: "custom",
        message: "repairTurn must not exceed maxRepairTurns",
        path: ["repairTurn"],
      });
    }
    if (
      control.resumeMode === "initial" &&
      control.previousTurnId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "initial control must not have previousTurnId",
        path: ["previousTurnId"],
      });
    }
    if (
      control.resumeMode !== "initial" &&
      (control.previousTurnId === undefined ||
        control.previousTurnId >= control.turnId)
    ) {
      context.addIssue({
        code: "custom",
        message: "resumed control requires an earlier previousTurnId",
        path: ["previousTurnId"],
      });
    }
  });

const managedInputFieldSchema = z
  .object({
    description: z.string().trim().max(4000).optional(),
    id: z.string().trim().min(1).max(256),
    key: z.string().trim().min(1).max(256),
    label: z.string().trim().min(1).max(512),
    options: z.array(z.string().max(1024)).max(128).optional(),
    required: z.boolean(),
    sensitive: z.boolean(),
    type: z.enum(["confirmation", "env", "secret", "text"]),
    valueType: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (field.type === "secret" && !field.sensitive) {
      context.addIssue({
        code: "custom",
        message: "secret input must be marked sensitive",
        path: ["sensitive"],
      });
    }
    if (
      !field.sensitive &&
      (field.valueType?.toLowerCase() === "password" ||
        SENSITIVE_INPUT_KEY_PATTERN.test(field.id) ||
        SENSITIVE_INPUT_KEY_PATTERN.test(field.key))
    ) {
      context.addIssue({
        code: "custom",
        message: "credential-like input must be marked sensitive",
        path: ["sensitive"],
      });
    }
  });

export const managedInputsRequiredSchema = envelopeSchema
  .extend({
    inputs: z.array(managedInputFieldSchema).min(1).max(64),
    reason: z.string().trim().min(1).max(4000).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    request.inputs.forEach((field, index) => {
      if (ids.has(field.id)) {
        context.addIssue({
          code: "custom",
          message: "input ids must be unique",
          path: ["inputs", index, "id"],
        });
      }
      if (keys.has(field.key)) {
        context.addIssue({
          code: "custom",
          message: "input keys must be unique",
          path: ["inputs", index, "key"],
        });
      }
      ids.add(field.id);
      keys.add(field.key);
    });
  });

const managedMutationSchema = z
  .object({
    fieldManager: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(FIELD_MANAGER_PATTERN)
      .optional(),
    operation: z.enum([
      "apply",
      "create",
      "delete",
      "exec",
      "patch",
      "replace",
      "rollout",
    ]),
    preconditionUid: z.string().trim().min(1).max(256).nullable(),
    resource: managedResourceRefSchema,
  })
  .strict()
  .superRefine((mutation, context) => {
    if (mutation.operation !== "exec" && mutation.fieldManager === undefined) {
      context.addIssue({
        code: "custom",
        message: "Kubernetes mutation requires fieldManager",
        path: ["fieldManager"],
      });
    }
    if (mutation.operation === "delete" && mutation.preconditionUid == null) {
      context.addIssue({
        code: "custom",
        message: "delete mutation requires preconditionUid",
        path: ["preconditionUid"],
      });
    }
    if (
      mutation.resource.uid !== undefined &&
      mutation.preconditionUid !== null &&
      mutation.resource.uid !== mutation.preconditionUid
    ) {
      context.addIssue({
        code: "custom",
        message: "preconditionUid must match the resource uid",
        path: ["preconditionUid"],
      });
    }
  });

const managedDiagnosticSchema = z
  .object({
    evidencePath: contractRelativePathSchema.optional(),
    kind: z.enum(["condition", "event", "http", "log", "other"]),
    resource: managedResourceRefSchema.optional(),
    summary: z.string().trim().min(1).max(8000),
  })
  .strict();

export const managedTurnReportSchema = envelopeSchema
  .extend({
    diagnostics: z.array(managedDiagnosticSchema).max(64).default([]),
    inputsRequiredPath: contractRelativePathSchema.optional(),
    mutations: z.array(managedMutationSchema).max(512),
    outcome: z.enum([
      "inputs-required",
      "applied",
      "needs-repair",
      "verified",
      "fatal",
    ]),
    summary: z.string().trim().min(1).max(8000),
    verifyReportPath: contractRelativePathSchema.optional(),
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.outcome === "inputs-required" &&
      report.inputsRequiredPath === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "inputs-required outcome requires inputsRequiredPath",
        path: ["inputsRequiredPath"],
      });
    }
    if (report.outcome === "inputs-required" && report.mutations.length > 0) {
      context.addIssue({
        code: "custom",
        message: "inputs-required outcome must precede all mutations",
        path: ["mutations"],
      });
    }
    if (
      report.outcome === "verified" &&
      report.verifyReportPath === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "verified outcome requires verifyReportPath",
        path: ["verifyReportPath"],
      });
    }
  });

export const managedMutationIntentSchema = envelopeSchema.strict();

const managedVerificationCheckSchema = z
  .object({
    evidencePath: contractRelativePathSchema.optional(),
    kind: z.enum([
      "custom",
      "database",
      "events",
      "http",
      "job",
      "logs",
      "public-access",
      "service-endpoints",
      "workload",
    ]),
    resource: managedResourceRefSchema.optional(),
    status: z.enum(["failed", "passed", "skipped"]),
    summary: z.string().trim().min(1).max(8000),
    target: z.string().trim().min(1).max(2048).optional(),
  })
  .strict()
  .superRefine((check, context) => {
    if (
      (check.kind === "http" || check.kind === "public-access") &&
      check.status === "passed" &&
      check.target === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "passed HTTP verification requires a target",
        path: ["target"],
      });
    }
  });

const managedArtifactDigestSchema = z
  .object({
    path: contractRelativePathSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const managedVerifyReportSchema = envelopeSchema
  .extend({
    artifacts: z.array(managedArtifactDigestSchema).max(32).default([]),
    checks: z.array(managedVerificationCheckSchema).min(1).max(128),
    resources: z.array(managedResourceRefSchema).max(256),
    summary: z.string().trim().min(1).max(8000),
    verdict: z.enum(["failed", "passed"]),
  })
  .strict()
  .superRefine((report, context) => {
    const failedCheck = report.checks.findIndex(
      (check) => check.status === "failed"
    );
    if (report.verdict === "passed" && failedCheck !== -1) {
      context.addIssue({
        code: "custom",
        message: "passed verdict must not contain failed checks",
        path: ["checks", failedCheck, "status"],
      });
    }
    if (
      report.verdict === "passed" &&
      !report.checks.some((check) => check.status === "passed")
    ) {
      context.addIssue({
        code: "custom",
        message: "passed verdict requires at least one passed check",
        path: ["checks"],
      });
    }
  });

export type ManagedDeploymentControl = z.infer<
  typeof managedDeploymentControlSchema
>;
export type ManagedInputsRequired = z.infer<typeof managedInputsRequiredSchema>;
export type ManagedTurnReport = z.infer<typeof managedTurnReportSchema>;
export type ManagedVerifyReport = z.infer<typeof managedVerifyReportSchema>;
export type ManagedResourceRef = z.infer<typeof managedResourceRefSchema>;
export type ManagedMutationIntent = z.infer<typeof managedMutationIntentSchema>;

export class ManagedDeploymentContractError extends Error {
  readonly code:
    | "invalid-json"
    | "invalid-schema"
    | "stale-envelope"
    | "too-large";

  constructor(
    code: ManagedDeploymentContractError["code"],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.code = code;
    this.name = "ManagedDeploymentContractError";
  }
}

function parseContract<T>(input: {
  contents: string;
  label: string;
  maxBytes: number;
  schema: z.ZodType<T>;
}): T {
  if (Buffer.byteLength(input.contents, "utf8") > input.maxBytes) {
    throw new ManagedDeploymentContractError(
      "too-large",
      `${input.label} exceeds its ${input.maxBytes} byte limit.`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(input.contents);
  } catch (error) {
    throw new ManagedDeploymentContractError(
      "invalid-json",
      `${input.label} is not valid JSON.`,
      { cause: error }
    );
  }
  const parsed = input.schema.safeParse(value);
  if (!parsed.success) {
    throw new ManagedDeploymentContractError(
      "invalid-schema",
      `${input.label} does not match managed deployment contract v${MANAGED_DEPLOYMENT_CONTRACT_VERSION}.`,
      { cause: parsed.error }
    );
  }
  return parsed.data;
}

export function parseManagedDeploymentControl(
  contents: string
): ManagedDeploymentControl {
  return parseContract({
    contents,
    label: "control.json",
    maxBytes: MANAGED_CONTROL_MAX_BYTES,
    schema: managedDeploymentControlSchema,
  });
}

export function parseManagedInputsRequired(
  contents: string
): ManagedInputsRequired {
  return parseContract({
    contents,
    label: "inputs-required.json",
    maxBytes: MANAGED_INPUTS_REQUIRED_MAX_BYTES,
    schema: managedInputsRequiredSchema,
  });
}

export function parseManagedTurnReport(contents: string): ManagedTurnReport {
  return parseContract({
    contents,
    label: "turn-report.json",
    maxBytes: MANAGED_TURN_REPORT_MAX_BYTES,
    schema: managedTurnReportSchema,
  });
}

export function parseManagedMutationIntent(
  contents: string
): ManagedMutationIntent {
  return parseContract({
    contents,
    label: "mutation-intent.json",
    maxBytes: MANAGED_CONTROL_MAX_BYTES,
    schema: managedMutationIntentSchema,
  });
}

export function parseManagedVerifyReport(
  contents: string
): ManagedVerifyReport {
  return parseContract({
    contents,
    label: "verify-report.json",
    maxBytes: MANAGED_VERIFY_REPORT_MAX_BYTES,
    schema: managedVerifyReportSchema,
  });
}

export function assertManagedContractEnvelope(
  contract: { taskId: string; turnId: number },
  expected: { taskId: string; turnId: number }
): void {
  if (
    contract.taskId !== expected.taskId ||
    contract.turnId !== expected.turnId
  ) {
    throw new ManagedDeploymentContractError(
      "stale-envelope",
      "Managed deployment contract belongs to another task or turn."
    );
  }
}

export function assertManagedTurnReportForControl(
  report: ManagedTurnReport,
  control: ManagedDeploymentControl
): void {
  assertManagedContractEnvelope(report, control);
}

export function managedTurnOutcomeStartsApplying(
  outcome: ManagedTurnReport["outcome"]
): boolean {
  return (
    outcome === "applied" ||
    outcome === "needs-repair" ||
    outcome === "verified"
  );
}

export function assertManagedVerifyReportForControl(
  report: ManagedVerifyReport,
  control: ManagedDeploymentControl
): void {
  assertManagedContractEnvelope(report, control);
  if (
    report.resources.some(
      (resource) => resource.namespace !== control.identity.namespace
    ) ||
    report.checks.some(
      (check) =>
        check.resource !== undefined &&
        check.resource.namespace !== control.identity.namespace
    )
  ) {
    throw new ManagedDeploymentContractError(
      "invalid-schema",
      "Managed verification report references a resource outside its namespace."
    );
  }
}

function assertSafeAbsolutePath(value: string, label: string): void {
  if (
    !value.startsWith("/") ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r") ||
    path.normalize(value) !== value
  ) {
    throw new Error(`${label} must be a normalized absolute path.`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildAtomicJsonWriteCommand(input: {
  allowedRoot: string;
  maxBytes?: number;
  mode?: "0600" | "0644";
  path: string;
  value: unknown;
}): string {
  assertSafeAbsolutePath(input.path, "Atomic JSON target");
  const allowedRoot = normalizedSafeRoot(input.allowedRoot);
  if (allowedRoot == null || !input.path.startsWith(`${allowedRoot}/`)) {
    throw new Error("Atomic JSON target must be inside its allowed root.");
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input.value, null, 2);
  } catch (error) {
    throw new ManagedDeploymentContractError(
      "invalid-schema",
      "Atomic JSON payload is not serializable.",
      { cause: error }
    );
  }
  if (serialized === undefined) {
    throw new ManagedDeploymentContractError(
      "invalid-schema",
      "Atomic JSON payload is not serializable."
    );
  }
  const contents = `${serialized}\n`;
  const maxBytes = input.maxBytes ?? MANAGED_TURN_REPORT_MAX_BYTES;
  if (Buffer.byteLength(contents, "utf8") > maxBytes) {
    throw new ManagedDeploymentContractError(
      "too-large",
      `Atomic JSON payload exceeds its ${maxBytes} byte limit.`
    );
  }
  const encoded = Buffer.from(contents, "utf8").toString("base64");
  return [
    "set -euo pipefail",
    "umask 077",
    `target=${shellQuote(input.path)}`,
    'target_dir="$(dirname "$target")"',
    'mkdir -p "$target_dir"',
    'chmod 0700 "$target_dir"',
    'tmp="$(mktemp "$target_dir/.sealai-contract.XXXXXX")"',
    'cleanup() { rm -f "$tmp"; }',
    "trap cleanup EXIT",
    `printf '%s' ${shellQuote(encoded)} | base64 -d > "$tmp"`,
    `chmod ${input.mode ?? "0600"} "$tmp"`,
    'mv -f "$tmp" "$target"',
    "if id devbox >/dev/null 2>&1; then",
    '  if [ "$(id -u)" = "0" ]; then',
    '    chown devbox:devbox "$target_dir" "$target"',
    "  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then",
    '    sudo chown devbox:devbox "$target_dir" "$target"',
    "  fi",
    "fi",
    "trap - EXIT",
  ].join("\n");
}

export function buildAtomicStdinWriteCommand(input: {
  allowedRoot: string;
  maxBytes: number;
  mode?: "0600" | "0644";
  path: string;
}): string {
  assertSafeAbsolutePath(input.path, "Atomic stdin target");
  const allowedRoot = normalizedSafeRoot(input.allowedRoot);
  if (allowedRoot == null || !input.path.startsWith(`${allowedRoot}/`)) {
    throw new Error("Atomic stdin target must be inside its allowed root.");
  }
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
    throw new Error("Atomic stdin byte limit must be a positive integer.");
  }
  return [
    "set -euo pipefail",
    "umask 077",
    `target=${shellQuote(input.path)}`,
    'target_dir="$(dirname "$target")"',
    'mkdir -p "$target_dir"',
    'chmod 0700 "$target_dir"',
    'tmp="$(mktemp "$target_dir/.sealai-contract.XXXXXX")"',
    'cleanup() { rm -f "$tmp"; }',
    "trap cleanup EXIT",
    'cat > "$tmp"',
    `test "$(wc -c < "$tmp")" -le ${input.maxBytes}`,
    `chmod ${input.mode ?? "0600"} "$tmp"`,
    'mv -f "$tmp" "$target"',
    "if id devbox >/dev/null 2>&1; then",
    '  if [ "$(id -u)" = "0" ]; then',
    '    chown devbox:devbox "$target_dir" "$target"',
    "  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then",
    '    sudo chown devbox:devbox "$target_dir" "$target"',
    "  fi",
    "fi",
    "trap - EXIT",
  ].join("\n");
}

export function buildManagedInputRemovalCommand(input: {
  inputPath: string;
  root: string;
  taskId: string;
}): string {
  if (!isManagedInputPathForTask(input)) {
    throw new Error(
      "Managed input removal requires the exact task input path."
    );
  }
  return [
    "set -euo pipefail",
    `input_path=${shellQuote(input.inputPath)}`,
    'rm -f -- "$input_path"',
    'rmdir -- "$(dirname "$input_path")" 2>/dev/null || true',
  ].join("\n");
}

export const managedInputMountProbeSchema = z
  .object({
    creatable: z.boolean(),
    exists: z.boolean(),
    filesystemType: z.enum(["other", "tmpfs", "unknown"]),
    writable: z.boolean(),
  })
  .strict();

export type ManagedInputMountProbe = z.infer<
  typeof managedInputMountProbeSchema
>;

export function buildManagedInputMountProbeCommand(root: string): string {
  assertSafeAbsolutePath(root, "Managed input root");
  const script = [
    'const fs = require("node:fs");',
    "const root = process.env.SEALAI_PROBE_ROOT;",
    "let exists = false;",
    "let creatable = false;",
    "let writable = false;",
    'let filesystemType = "unknown";',
    "try {",
    "  exists = fs.existsSync(root) && fs.statSync(root).isDirectory();",
    "  let probeRoot = root;",
    "  while (!fs.existsSync(probeRoot)) {",
    '    const parent = require("node:path").dirname(probeRoot);',
    "    if (parent === probeRoot) break;",
    "    probeRoot = parent;",
    "  }",
    "  fs.accessSync(probeRoot, fs.constants.W_OK);",
    "  writable = true;",
    "  creatable = !exists;",
    "  const fsType = Number(fs.statfsSync(probeRoot).type) >>> 0;",
    '  filesystemType = fsType === 0x01021994 ? "tmpfs" : "other";',
    "} catch {}",
    "process.stdout.write(JSON.stringify({ creatable, exists, filesystemType, writable }));",
  ].join(" ");
  return `SEALAI_PROBE_ROOT=${shellQuote(root)} node -e ${shellQuote(script)}`;
}

export function parseManagedInputMountProbe(
  contents: string
): ManagedInputMountProbe {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new ManagedDeploymentContractError(
      "invalid-json",
      "Managed input mount probe is not valid JSON.",
      { cause: error }
    );
  }
  const parsed = managedInputMountProbeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ManagedDeploymentContractError(
      "invalid-schema",
      "Managed input mount probe has an invalid result.",
      { cause: parsed.error }
    );
  }
  return parsed.data;
}

export type ManagedInputStorageKind =
  | "platform-ephemeral"
  | "tmpfs"
  | "workspace-private";

export interface ManagedInputStorageCandidate {
  archiveExcluded: boolean;
  kind: ManagedInputStorageKind;
  probe: ManagedInputMountProbe;
  root: string;
  wipeVerified: boolean;
}

export type ManagedInputPathRejectionReason =
  | "archive-included"
  | "missing"
  | "not-tmpfs"
  | "outside-private-workspace"
  | "unsafe-root"
  | "unverified-wipe"
  | "unwritable";

export interface ManagedInputPathDecision {
  accepted: {
    inputPath: string;
    kind: ManagedInputStorageKind;
    root: string;
  } | null;
  rejected: {
    kind: ManagedInputStorageKind;
    reason: ManagedInputPathRejectionReason;
    root: string;
  }[];
}

const STORAGE_PRIORITY: Record<ManagedInputStorageKind, number> = {
  tmpfs: 0,
  "platform-ephemeral": 1,
  "workspace-private": 2,
};

function normalizedSafeRoot(root: string): string | null {
  if (
    !root.startsWith("/") ||
    root.includes("\0") ||
    root.includes("\n") ||
    root.includes("\r") ||
    path.normalize(root) !== root ||
    root === "/"
  ) {
    return null;
  }
  return root;
}

function rejectionReason(
  candidate: ManagedInputStorageCandidate
): ManagedInputPathRejectionReason | null {
  const root = normalizedSafeRoot(candidate.root);
  if (root == null) {
    return "unsafe-root";
  }
  if (!(candidate.probe.exists || candidate.probe.creatable)) {
    return "missing";
  }
  if (!candidate.probe.writable) {
    return "unwritable";
  }
  if (candidate.kind === "tmpfs") {
    return candidate.probe.filesystemType === "tmpfs" ? null : "not-tmpfs";
  }
  if (!candidate.archiveExcluded) {
    return "archive-included";
  }
  if (candidate.kind === "workspace-private") {
    const privateWorkspaceRoot = "/home/devbox/project/.sealos/";
    if (!root.startsWith(privateWorkspaceRoot)) {
      return "outside-private-workspace";
    }
    if (!candidate.wipeVerified) {
      return "unverified-wipe";
    }
  }
  return null;
}

export function selectManagedInputPath(input: {
  candidates: readonly ManagedInputStorageCandidate[];
  taskId: string;
}): ManagedInputPathDecision {
  const taskId = taskIdSchema.parse(input.taskId);
  const rejected: ManagedInputPathDecision["rejected"] = [];
  const candidates = [...input.candidates].sort(
    (left, right) => STORAGE_PRIORITY[left.kind] - STORAGE_PRIORITY[right.kind]
  );
  for (const candidate of candidates) {
    const reason = rejectionReason(candidate);
    if (reason !== null) {
      rejected.push({ kind: candidate.kind, reason, root: candidate.root });
      continue;
    }
    return {
      accepted: {
        inputPath: path.join(candidate.root, taskId, "inputs.json"),
        kind: candidate.kind,
        root: candidate.root,
      },
      rejected,
    };
  }
  return { accepted: null, rejected };
}

export function isManagedInputPathForTask(input: {
  inputPath: string;
  root: string;
  taskId: string;
}): boolean {
  const root = normalizedSafeRoot(input.root);
  const task = taskIdSchema.safeParse(input.taskId);
  if (root == null || !task.success) {
    return false;
  }
  return input.inputPath === path.join(root, task.data, "inputs.json");
}
