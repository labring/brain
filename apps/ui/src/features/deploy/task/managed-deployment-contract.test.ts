import { describe, expect, it } from "bun:test";

import {
  assertManagedContractEnvelope,
  assertManagedTurnReportForControl,
  assertManagedVerifyReportForControl,
  buildAtomicJsonWriteCommand,
  buildAtomicStdinWriteCommand,
  buildManagedInputMountProbeCommand,
  buildManagedInputRemovalCommand,
  isManagedInputPathForTask,
  MANAGED_CONTROL_MAX_BYTES,
  MANAGED_INPUT_VALUES_MAX_BYTES,
  ManagedDeploymentContractError,
  type ManagedInputStorageCandidate,
  parseManagedDeploymentControl,
  parseManagedInputMountProbe,
  parseManagedInputsRequired,
  parseManagedTurnReport,
  parseManagedVerifyReport,
  selectManagedInputPath,
} from "./managed-deployment-contract";

const TASK_ID = "0a0ed7c8-daa9-487e-8d08-0fb506658881";

function control(overrides: Record<string, unknown> = {}) {
  return {
    deadlineAt: "2026-08-04T09:00:00.000Z",
    fieldManager: "sealai-test",
    identity: {
      instanceName: "brain-app-123",
      namespace: "ns-123",
      projectId: "project-123",
    },
    maxMutatedResourcesPerTurn: 128,
    maxRepairTurns: 2,
    mode: "brain-managed",
    mutationAuthorizationPath: ".sealos/brain/mutation-authorized.json",
    mutationAuthorizationRequired: true,
    mutationIntentPath: ".sealos/brain/mutation-intent.json",
    repairTurn: 0,
    resumeMode: "initial",
    schemaVersion: 1,
    taskId: TASK_ID,
    turnId: 0,
    ...overrides,
  };
}

describe("managed deployment contracts", () => {
  it("parses a strict control envelope", () => {
    const parsed = parseManagedDeploymentControl(JSON.stringify(control()));
    expect(parsed.taskId).toBe(TASK_ID);
    expect(parsed.mode).toBe("brain-managed");
    expect(() =>
      parseManagedDeploymentControl(
        JSON.stringify(control({ unexpected: "fail closed" }))
      )
    ).toThrow(ManagedDeploymentContractError);
  });

  it("enforces resume lineage and repair bounds", () => {
    expect(() =>
      parseManagedDeploymentControl(
        JSON.stringify(
          control({
            repairTurn: 3,
            resumeMode: "repair",
            turnId: 2,
          })
        )
      )
    ).toThrow();
    expect(
      parseManagedDeploymentControl(
        JSON.stringify(
          control({
            previousTurnId: 0,
            repairTurn: 1,
            resumeMode: "repair",
            turnId: 1,
          })
        )
      ).resumeMode
    ).toBe("repair");
  });

  it("rejects oversized, invalid, and stale envelopes without echoing contents", () => {
    expect(() =>
      parseManagedDeploymentControl("x".repeat(MANAGED_CONTROL_MAX_BYTES + 1))
    ).toThrow("exceeds");
    expect(() => parseManagedDeploymentControl("{secret")).toThrow(
      "not valid JSON"
    );
    expect(() =>
      assertManagedContractEnvelope(control(), {
        taskId: TASK_ID,
        turnId: 1,
      })
    ).toThrow("another task or turn");
  });

  it("accepts canonical input fields and rejects defaults, unmarked secrets, or duplicate keys", () => {
    const request = {
      inputs: [
        {
          id: "DATABASE_PASSWORD",
          key: "DATABASE_PASSWORD",
          label: "Database password",
          required: true,
          sensitive: true,
          type: "secret",
          valueType: "password",
        },
      ],
      schemaVersion: 1,
      taskId: TASK_ID,
      turnId: 0,
    };
    expect(
      parseManagedInputsRequired(JSON.stringify(request)).inputs
    ).toHaveLength(1);
    expect(() =>
      parseManagedInputsRequired(
        JSON.stringify({
          ...request,
          inputs: [{ ...request.inputs[0], defaultValue: "do-not-persist" }],
        })
      )
    ).toThrow();
    expect(() =>
      parseManagedInputsRequired(
        JSON.stringify({
          ...request,
          inputs: [
            {
              ...request.inputs[0],
              sensitive: false,
              type: "env",
              valueType: "string",
            },
          ],
        })
      )
    ).toThrow();
    expect(() =>
      parseManagedInputsRequired(
        JSON.stringify({
          ...request,
          inputs: [request.inputs[0], { ...request.inputs[0], id: "OTHER" }],
        })
      )
    ).toThrow();
  });

  it("requires report paths for blocking and verified outcomes", () => {
    const base = {
      diagnostics: [],
      mutations: [],
      schemaVersion: 1,
      summary: "Turn complete.",
      taskId: TASK_ID,
      turnId: 0,
    };
    expect(() =>
      parseManagedTurnReport(
        JSON.stringify({ ...base, outcome: "inputs-required" })
      )
    ).toThrow();
    expect(() =>
      parseManagedTurnReport(
        JSON.stringify({
          ...base,
          inputsRequiredPath: ".sealos/brain/inputs-required.json",
          mutations: [
            {
              fieldManager: "sealai-test",
              operation: "apply",
              preconditionUid: null,
              resource: {
                apiVersion: "apps/v1",
                kind: "Deployment",
                name: "app",
                namespace: "ns-123",
              },
            },
          ],
          outcome: "inputs-required",
        })
      )
    ).toThrow();
    expect(
      parseManagedTurnReport(
        JSON.stringify({
          ...base,
          outcome: "verified",
          verifyReportPath: ".sealos/brain/verify-report.json",
        })
      ).outcome
    ).toBe("verified");
  });

  it("requires delete preconditions and consistent passed verification", () => {
    const resource = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "app",
      namespace: "ns-123",
    };
    expect(() =>
      parseManagedTurnReport(
        JSON.stringify({
          diagnostics: [],
          mutations: [
            {
              fieldManager: "sealai-test",
              operation: "delete",
              preconditionUid: null,
              resource,
            },
          ],
          outcome: "fatal",
          schemaVersion: 1,
          summary: "Unsafe delete was refused.",
          taskId: TASK_ID,
          turnId: 1,
        })
      )
    ).toThrow();

    const report = {
      artifacts: [],
      checks: [
        {
          kind: "workload",
          resource,
          status: "failed",
          summary: "Deployment is not ready.",
        },
      ],
      resources: [resource],
      schemaVersion: 1,
      summary: "Verification complete.",
      taskId: TASK_ID,
      turnId: 1,
      verdict: "passed",
    };
    expect(() => parseManagedVerifyReport(JSON.stringify(report))).toThrow();
    expect(() =>
      parseManagedVerifyReport(
        JSON.stringify({
          ...report,
          checks: [
            {
              kind: "http",
              status: "passed",
              summary: "HTTP is ready.",
            },
          ],
        })
      )
    ).toThrow();
    expect(
      parseManagedVerifyReport(
        JSON.stringify({
          ...report,
          checks: [{ ...report.checks[0], status: "passed" }],
        })
      ).verdict
    ).toBe("passed");
  });

  it("validates reports against the authoritative control", () => {
    const parsedControl = parseManagedDeploymentControl(
      JSON.stringify(control({ maxMutatedResourcesPerTurn: 1 }))
    );
    const mutation = {
      fieldManager: "sealai-test",
      operation: "apply" as const,
      preconditionUid: null,
      resource: {
        apiVersion: "apps/v1",
        kind: "Deployment",
        name: "app",
        namespace: "ns-123",
      },
    };
    const turnReport = parseManagedTurnReport(
      JSON.stringify({
        diagnostics: [],
        mutations: [mutation],
        outcome: "applied",
        schemaVersion: 1,
        summary: "Applied once.",
        taskId: TASK_ID,
        turnId: 0,
      })
    );
    expect(() =>
      assertManagedTurnReportForControl(turnReport, parsedControl)
    ).not.toThrow();
    expect(() =>
      assertManagedTurnReportForControl(
        { ...turnReport, mutations: [mutation, mutation] },
        parsedControl
      )
    ).toThrow("mutation limit");

    const verifyReport = parseManagedVerifyReport(
      JSON.stringify({
        artifacts: [],
        checks: [
          {
            kind: "workload",
            resource: { ...mutation.resource, namespace: "other-ns" },
            status: "failed",
            summary: "Out of bounds.",
          },
        ],
        resources: [],
        schemaVersion: 1,
        summary: "Verification complete.",
        taskId: TASK_ID,
        turnId: 0,
        verdict: "failed",
      })
    );
    expect(() =>
      assertManagedVerifyReportForControl(verifyReport, parsedControl)
    ).toThrow("outside its namespace");
  });
});

describe("managed deployment atomic commands", () => {
  it("base64-encodes JSON and atomically renames a private temporary file", () => {
    const command = buildAtomicJsonWriteCommand({
      allowedRoot: "/home/devbox/project/.sealos/brain",
      path: "/home/devbox/project/.sealos/brain/control.json",
      value: { value: "quote ' and $(touch /tmp/nope)" },
    });
    expect(command).toContain("umask 077");
    expect(command).toContain("mktemp");
    expect(command).toContain("base64 -d");
    expect(command).toContain("mv -f");
    expect(command).toContain('chown devbox:devbox "$target_dir" "$target"');
    expect(command).not.toContain("touch /tmp/nope");
  });

  it("writes sensitive JSON from stdin without embedding it in the command", () => {
    const command = buildAtomicStdinWriteCommand({
      allowedRoot: "/dev/shm/sealai",
      maxBytes: MANAGED_INPUT_VALUES_MAX_BYTES,
      path: `/dev/shm/sealai/${TASK_ID}/inputs.json`,
    });

    expect(command).toContain('cat > "$tmp"');
    expect(command).toContain(`-le ${MANAGED_INPUT_VALUES_MAX_BYTES}`);
    expect(command).not.toContain("DATABASE_PASSWORD");
  });

  it("rejects non-normalized target paths", () => {
    expect(() =>
      buildAtomicJsonWriteCommand({
        allowedRoot: "/home/devbox/project/.sealos/brain",
        path: "/home/devbox/project/.sealos/../secret.json",
        value: {},
      })
    ).toThrow("normalized absolute path");
  });

  it("limits atomic writes and cleanup to their declared task roots", () => {
    expect(() =>
      buildAtomicJsonWriteCommand({
        allowedRoot: "/home/devbox/project/.sealos/brain",
        path: "/home/devbox/project/other.json",
        value: {},
      })
    ).toThrow("allowed root");
    expect(() =>
      buildManagedInputRemovalCommand({
        inputPath: "/dev/shm/sealai/other/inputs.json",
        root: "/dev/shm/sealai",
        taskId: TASK_ID,
      })
    ).toThrow("exact task input path");
  });

  it("builds and validates a mount probe without interpolating its root in JS", () => {
    const command = buildManagedInputMountProbeCommand("/dev/shm/sealai");
    expect(command).toContain("SEALAI_PROBE_ROOT='/dev/shm/sealai'");
    expect(
      parseManagedInputMountProbe(
        '{"creatable":false,"exists":true,"filesystemType":"tmpfs","writable":true}'
      )
    ).toEqual({
      creatable: false,
      exists: true,
      filesystemType: "tmpfs",
      writable: true,
    });
    expect(() =>
      parseManagedInputMountProbe(
        '{"creatable":false,"exists":true,"filesystemType":"tmpfs","writable":true,"extra":1}'
      )
    ).toThrow();
  });
});

function candidate(
  input: Partial<ManagedInputStorageCandidate> &
    Pick<ManagedInputStorageCandidate, "kind" | "root">
): ManagedInputStorageCandidate {
  return {
    archiveExcluded: false,
    probe: {
      creatable: false,
      exists: true,
      filesystemType: "other",
      writable: true,
    },
    wipeVerified: false,
    ...input,
  };
}

describe("managed input path policy", () => {
  it("prefers a verified tmpfs regardless of candidate order", () => {
    const decision = selectManagedInputPath({
      candidates: [
        candidate({
          archiveExcluded: true,
          kind: "platform-ephemeral",
          root: "/run/sealai-inputs",
        }),
        candidate({
          kind: "tmpfs",
          probe: {
            creatable: false,
            exists: true,
            filesystemType: "tmpfs",
            writable: true,
          },
          root: "/dev/shm/sealai",
        }),
      ],
      taskId: TASK_ID,
    });
    expect(decision.accepted).toEqual({
      inputPath: `/dev/shm/sealai/${TASK_ID}/inputs.json`,
      kind: "tmpfs",
      root: "/dev/shm/sealai",
    });
  });

  it("falls back only to archive-excluded platform storage", () => {
    const decision = selectManagedInputPath({
      candidates: [
        candidate({ kind: "tmpfs", root: "/dev/shm/sealai" }),
        candidate({
          archiveExcluded: true,
          kind: "platform-ephemeral",
          root: "/run/sealai-inputs",
        }),
      ],
      taskId: TASK_ID,
    });
    expect(decision.accepted?.kind).toBe("platform-ephemeral");
    expect(decision.rejected).toEqual([
      { kind: "tmpfs", reason: "not-tmpfs", root: "/dev/shm/sealai" },
    ]);
  });

  it("requires private workspace placement, archive exclusion, and verified wipe", () => {
    const rejected = selectManagedInputPath({
      candidates: [
        candidate({
          archiveExcluded: true,
          kind: "workspace-private",
          root: "/home/devbox/project/.sealos/private-inputs",
        }),
      ],
      taskId: TASK_ID,
    });
    expect(rejected.accepted).toBeNull();
    expect(rejected.rejected[0]?.reason).toBe("unverified-wipe");

    const accepted = selectManagedInputPath({
      candidates: [
        candidate({
          archiveExcluded: true,
          kind: "workspace-private",
          root: "/home/devbox/project/.sealos/private-inputs",
          wipeVerified: true,
        }),
      ],
      taskId: TASK_ID,
    });
    expect(accepted.accepted?.kind).toBe("workspace-private");
  });

  it("matches only the exact task input path", () => {
    const root = "/dev/shm/sealai";
    expect(
      isManagedInputPathForTask({
        inputPath: `${root}/${TASK_ID}/inputs.json`,
        root,
        taskId: TASK_ID,
      })
    ).toBe(true);
    expect(
      isManagedInputPathForTask({
        inputPath: `${root}/${TASK_ID}/../other/inputs.json`,
        root,
        taskId: TASK_ID,
      })
    ).toBe(false);
  });
});
