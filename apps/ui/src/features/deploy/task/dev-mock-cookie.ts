import { defineDevMockCookie } from "@/features/dev-mock/cookie";

/**
 * The Deployment Task Timeline Dev Mock's cookie: one fixture Deployment
 * Task per scenario, served as a static timeline snapshot (no event
 * replay) plus the canvas projection that lets its chip appear.
 */

export const DEPLOY_TASK_DEV_SCENARIOS = [
  "running",
  "blocked",
  "failed",
  "failed-balance",
  "failed-quota",
  "succeeded",
  "succeeded-eaglercraft",
  "cancelled",
] as const;

export type DeployTaskDevScenario = (typeof DEPLOY_TASK_DEV_SCENARIOS)[number];

export const DEFAULT_DEPLOY_TASK_DEV_SCENARIO: DeployTaskDevScenario =
  "running";

export const deployTaskDevMockCookie =
  defineDevMockCookie<DeployTaskDevScenario>({
    defaultScenario: DEFAULT_DEPLOY_TASK_DEV_SCENARIO,
    name: "sealai-deploy-task-dev-mock",
    scenarios: DEPLOY_TASK_DEV_SCENARIOS,
  });

/** The fixture task's id; the timeline route answers from fixtures only for it. */
export function deployTaskDevMockTaskId(
  scenario: DeployTaskDevScenario
): string {
  return `mock-task-${scenario}`;
}
