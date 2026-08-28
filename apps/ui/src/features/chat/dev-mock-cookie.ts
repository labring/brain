import { defineDevMockCookie } from "@/features/dev-mock/cookie";

/**
 * The Conversation Dev Mock's cookie: the assistant transcript (session
 * bootstrap, thread list, thread messages) served from fixtures. Sending a
 * message still goes to the real `POST /api/chat`; Chat Billing Mode still
 * follows the billing mock.
 */

export const CHAT_DEV_SCENARIOS = ["empty", "short", "long"] as const;

export type ChatDevScenario = (typeof CHAT_DEV_SCENARIOS)[number];

export const DEFAULT_CHAT_DEV_SCENARIO: ChatDevScenario = "long";

export const chatDevMockCookie = defineDevMockCookie<ChatDevScenario>({
  defaultScenario: DEFAULT_CHAT_DEV_SCENARIO,
  name: "sealai-chat-dev-mock",
  scenarios: CHAT_DEV_SCENARIOS,
});
