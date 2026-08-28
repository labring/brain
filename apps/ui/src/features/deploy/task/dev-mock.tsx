"use client";

import { useDevTweaksMock } from "@workspace/dev-tweaks";

import { createDevMockCookieSource } from "@/features/dev-mock/source";

import {
  DEFAULT_DEPLOY_TASK_DEV_SCENARIO,
  DEPLOY_TASK_DEV_SCENARIOS,
  deployTaskDevMockCookie,
} from "./dev-mock-cookie";

export const DEPLOY_TASK_DEV_MOCK_KEY = "deploy-task-mock";

// The projection store and the timeline pane hold SSE connections keyed by
// credentials, not SWR keys; a reload is the one honest way to reconnect
// them to (or from) the fixtures.
const deployTaskDevMockSource = createDevMockCookieSource(
  deployTaskDevMockCookie,
  { revalidate: () => window.location.reload() }
);

/** Registers the mock while a Project Canvas is mounted; renders nothing. */
export function DeployTaskDevMockTweaks() {
  useDevTweaksMock(DEPLOY_TASK_DEV_MOCK_KEY, {
    defaultScenario: DEFAULT_DEPLOY_TASK_DEV_SCENARIO,
    note: "Serves one Deployment Task and its timeline from fixtures (static snapshot); toggling reloads the page",
    scenarios: DEPLOY_TASK_DEV_SCENARIOS,
    source: deployTaskDevMockSource,
    title: "Deployment task mock",
  });
  return null;
}
