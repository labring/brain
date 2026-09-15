"use client";

import { useDevTweaksMock } from "@workspace/dev-tweaks";

import { reloadForDevMock } from "@/features/dev-mock/reload";
import { createDevMockCookieSource } from "@/features/dev-mock/source";

import {
  DEFAULT_SESSION_DEV_SCENARIO,
  SESSION_DEV_SCENARIOS,
  sessionDevMockCookie,
} from "./dev-mock-cookie";

export const SESSION_DEV_MOCK_KEY = "session-mock";

const sessionDevMockSource = createDevMockCookieSource(sessionDevMockCookie);

/** Registers the mock with the app-global registry; renders nothing. */
export function SessionDevMockTweaks() {
  useDevTweaksMock(SESSION_DEV_MOCK_KEY, {
    defaultScenario: DEFAULT_SESSION_DEV_SCENARIO,
    note: "Serves POST /api/session from fixtures (fake credentials, one scenario per Workspace Role); toggling reloads the page",
    // The session is established once at mount; a reload is the one honest
    // way to re-establish it from (or off) the fixtures.
    revalidate: reloadForDevMock,
    scenarios: SESSION_DEV_SCENARIOS,
    source: sessionDevMockSource,
    title: "Session mock",
  });
  return null;
}
