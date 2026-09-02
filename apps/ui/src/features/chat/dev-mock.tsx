"use client";

import { useDevTweaksMock } from "@workspace/dev-tweaks";

import { reloadForDevMock } from "@/features/dev-mock/reload";
import { createDevMockCookieSource } from "@/features/dev-mock/source";

import {
  CHAT_DEV_SCENARIOS,
  chatDevMockCookie,
  DEFAULT_CHAT_DEV_SCENARIO,
} from "./dev-mock-cookie";

export const CHAT_DEV_MOCK_KEY = "chat-mock";

const chatDevMockSource = createDevMockCookieSource(chatDevMockCookie);

/** Registers the mock with the app-global registry; renders nothing. */
export function ChatDevMockTweaks() {
  useDevTweaksMock(CHAT_DEV_MOCK_KEY, {
    defaultScenario: DEFAULT_CHAT_DEV_SCENARIO,
    note: "Serves the assistant transcript from fixtures; sending still hits the model, except refused-* scenarios, which stage an aiproxy billing refusal; toggling reloads the page",
    // The chat pane bootstraps its session once per credential set, outside
    // SWR; a reload is the one honest way to re-bootstrap it from (or off)
    // the fixtures. The store only calls this when the served answers
    // actually changed, so browsing scenarios while the mock is off no
    // longer reloads anything.
    revalidate: reloadForDevMock,
    scenarios: CHAT_DEV_SCENARIOS,
    source: chatDevMockSource,
    title: "Chat mock",
  });
  return null;
}
