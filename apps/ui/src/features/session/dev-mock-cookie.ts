import { defineDevMockCookie } from "@/features/dev-mock/cookie";

/**
 * The Session Dev Mock's cookie (grammar in `features/dev-mock/cookie.ts`):
 * while it names a scenario, `POST /api/session` answers from fixtures
 * instead of exchanging the login cookie with Desktop, so the shell can be
 * exercised in each Workspace Role without a staging Desktop. The
 * credentials it hands out are fakes; pair it with the other Dev Mocks for
 * a fully offline page. Off by default: the real staging path runs unless a
 * scenario is explicitly selected.
 */

export const SESSION_DEV_SCENARIOS = [
  "owner-team",
  "manager",
  "developer",
  "personal-only",
] as const;

export type SessionDevScenario = (typeof SESSION_DEV_SCENARIOS)[number];

export const DEFAULT_SESSION_DEV_SCENARIO: SessionDevScenario = "owner-team";

export const sessionDevMockCookie = defineDevMockCookie<SessionDevScenario>({
  defaultScenario: DEFAULT_SESSION_DEV_SCENARIO,
  name: "sealai-session-dev-mock",
  scenarios: SESSION_DEV_SCENARIOS,
});
