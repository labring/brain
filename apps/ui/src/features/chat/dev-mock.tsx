"use client";

import { useDevTweaksMock } from "@workspace/dev-tweaks";

import { createDevMockCookieSource } from "@/features/dev-mock/source";

import {
  CHAT_DEV_SCENARIOS,
  chatDevMockCookie,
  DEFAULT_CHAT_DEV_SCENARIO,
} from "./dev-mock-cookie";

export const CHAT_DEV_MOCK_KEY = "chat-mock";

// The chat pane bootstraps its session once per credential set, outside
// SWR; a reload is the one honest way to re-bootstrap it from (or off) the
// fixtures.
const chatDevMockSource = createDevMockCookieSource(chatDevMockCookie, {
  revalidate: () => window.location.reload(),
});

/** Registers the mock while a Project Canvas is mounted; renders nothing. */
export function ChatDevMockTweaks() {
  useDevTweaksMock(CHAT_DEV_MOCK_KEY, {
    defaultScenario: DEFAULT_CHAT_DEV_SCENARIO,
    note: "Serves the assistant transcript from fixtures; sending still hits the model; toggling reloads the page",
    scenarios: CHAT_DEV_SCENARIOS,
    source: chatDevMockSource,
    title: "Chat mock",
  });
  return null;
}
