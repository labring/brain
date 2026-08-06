import type {
  DeploymentTaskRunner,
  DeploymentTaskSource,
  DeploymentTaskTarget,
  DeployTaskRow,
  DeployTaskStatus,
} from "../../schema";
import { deployTasks } from "../../schema";
import type { DeployTaskTestDb } from "./harness";

let fixtureCounter = 0;

export function nextFixtureId(prefix = "task"): string {
  fixtureCounter += 1;
  return `${prefix}-${fixtureCounter}`;
}

export interface TaskRowFixtureInput {
  artifactSummary?: DeployTaskRow["artifactSummary"];
  blockingInputs?: DeployTaskRow["blockingInputs"];
  cancelRequestedAt?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date;
  creatingActor?: string | null;
  credentialBinding?: DeployTaskRow["credentialBinding"];
  id?: string;
  leaseClaimedAt?: Date | null;
  leaseEpoch?: number;
  leaseExpiresAt?: Date | null;
  leaseOwner?: string | null;
  namespace?: string;
  phase?: DeployTaskRow["phase"];
  projectId?: string | null;
  retriedFromTaskId?: string | null;
  runner?: DeploymentTaskRunner;
  runtimeName?: string | null;
  runtimePausedAt?: Date | null;
  runtimeProvider?: string | null;
  runtimeState?: string | null;
  source?: DeploymentTaskSource;
  status?: DeployTaskStatus;
  target?: DeploymentTaskTarget;
}

export async function insertTaskRow(
  db: DeployTaskTestDb,
  input: TaskRowFixtureInput = {}
): Promise<DeployTaskRow> {
  const id = input.id ?? nextFixtureId();
  const defined = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  const [row] = await db
    .insert(deployTasks)
    .values({
      artifactSummary: {},
      blockingInputs: [],
      cancelRequestedAt: null,
      completedAt: null,
      createdAt: new Date(),
      leaseClaimedAt: null,
      leaseEpoch: 0,
      leaseExpiresAt: null,
      leaseOwner: null,
      namespace: "ns-test",
      phase: "queued",
      projectId: "project-test",
      retriedFromTaskId: null,
      runner: { kind: "template" },
      runtimeName: null,
      runtimePausedAt: null,
      runtimeProvider: null,
      runtimeState: null,
      source: { kind: "template", templateName: "demo" },
      status: "queued",
      target: { kind: "existingProject", projectId: "project-test" },
      ...defined,
      id,
      prompt: `Fixture task ${id}`,
    })
    .returning();
  if (row == null) {
    throw new Error("Failed to insert fixture task row.");
  }
  return row;
}
