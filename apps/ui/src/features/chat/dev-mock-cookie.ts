import { defineDevMockCookie } from "@/features/dev-mock/cookie";

/**
 * The Conversation Dev Mock's cookie: the assistant transcript (session
 * bootstrap, thread list, thread messages) served from fixtures. Sending a
 * message still goes to the real `POST /api/chat` — except in the
 * `refused-*` scenarios, which stage the interruption moment (design spec
 * row E3): the send answers with a reply that dies on a simulated aiproxy
 * billing refusal. Chat Billing Mode still follows the billing mock.
 */

export const CHAT_DEV_SCENARIOS = [
  "empty",
  "short",
  "long",
  "refused-ai-credits",
  "refused-balance",
] as const;

export type ChatDevScenario = (typeof CHAT_DEV_SCENARIOS)[number];

export type ChatDevRefusalScenario = Extract<
  ChatDevScenario,
  "refused-ai-credits" | "refused-balance"
>;

/** The scenarios whose send is answered by a simulated aiproxy refusal. */
export function isChatDevRefusalScenario(
  scenario: string
): scenario is ChatDevRefusalScenario {
  return scenario === "refused-ai-credits" || scenario === "refused-balance";
}

export const DEFAULT_CHAT_DEV_SCENARIO: ChatDevScenario = "long";

export const chatDevMockCookie = defineDevMockCookie<ChatDevScenario>({
  defaultScenario: DEFAULT_CHAT_DEV_SCENARIO,
  name: "sealai-chat-dev-mock",
  scenarios: CHAT_DEV_SCENARIOS,
});
