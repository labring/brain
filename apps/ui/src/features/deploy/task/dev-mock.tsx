"use client";

import { useDevTweaksMock } from "@workspace/dev-tweaks";

import { reloadForDevMock } from "@/features/dev-mock/reload";
import { createDevMockCookieSource } from "@/features/dev-mock/source";

import {
  DEFAULT_DEPLOY_TASK_DEV_SCENARIO,
  DEPLOY_TASK_DEV_SCENARIOS,
  deployTaskDevMockCookie,
} from "./dev-mock-cookie";

export const DEPLOY_TASK_DEV_MOCK_KEY = "deploy-task-mock";

const deployTaskDevMockSource = createDevMockCookieSource(
  deployTaskDevMockCookie
);

/** Registers the mock with the app-global registry; renders nothing. */
export function DeployTaskDevMockTweaks() {
  useDevTweaksMock(DEPLOY_TASK_DEV_MOCK_KEY, {
    defaultScenario: DEFAULT_DEPLOY_TASK_DEV_SCENARIO,
    note: "Serves one Deployment Task and its timeline from fixtures (static snapshot); toggling reloads the page",
    // The projection store and the timeline pane hold SSE connections keyed
    // by credentials, not SWR keys; a reload is the one honest way to
    // reconnect them to (or from) the fixtures. Only served-state changes
    // reload — picking a scenario while the mock is off does nothing.
    revalidate: reloadForDevMock,
    scenarios: DEPLOY_TASK_DEV_SCENARIOS,
    source: deployTaskDevMockSource,
    title: "Deployment task mock",
  });
  return null;
}
