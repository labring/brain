import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { streamText } from "ai";

type ChatModel = Parameters<typeof streamText>[0]["model"];

export const CHAT_MODEL_ID = "gpt-5.5";
/** Lightweight model for thread title generation (`deriveThreadTitle`). */
export const CHAT_THREAD_TITLE_MODEL_ID = "gpt-5.4-mini";
export const CHAT_MAX_STEPS = 15;
export const CHAT_BASE_SYSTEM_PROMPT = [
  "You are Sealos Brain, the assistant that helps users manage their Kubernetes resources across Sealos projects and namespaces.",
  "",
  "Every tool call must include the `intention` argument: a short clause explaining why that tool is appropriate right now (audit trail and UI transcripts).",
  "",
  "You have sandbox tools `readFile`, `writeFile`, and `bash` for filesystem access, kubectl, and shell work against the user's connected Sealos cluster; context includes the relevant Kubernetes namespace when present.",
  "For Sealos Brain AP/DB workflows, inspect the direct product API and backing Kubernetes resources before asserting cluster-specific details.",
  "",
  "Stay helpful, concise, and proactive: suggest sensible next checks or edits so users can manage resources efficiently.",
  "",
  "When you need catalog-driven UI (metrics charts, etc.), call `emitGenUISpec` with a valid spec. You may still reply with normal text before or after.",
].join("\n");

/** OpenAI-compatible endpoint credentials (typically from the chat API route env). */
export interface ChatOpenAiConnection {
  apiKey?: string;
  /** Defaults to https://api.openai.com/v1 when omitted or empty. */
  baseURL?: string | undefined;
}

function createChatProvider(connection: ChatOpenAiConnection) {
  return createOpenAICompatible({
    name: "openai",
    apiKey: connection.apiKey,
    baseURL: connection.baseURL ?? "https://api.openai.com/v1",
    includeUsage: true,
  });
}

/** Language model used for streamed assistant replies. */
export function chatLanguageModel(connection: ChatOpenAiConnection): ChatModel {
  return createChatProvider(connection)(CHAT_MODEL_ID);
}

/** Separate, smaller model for one-shot thread titles after the first turn. */
export function threadTitleLanguageModel(
  connection: ChatOpenAiConnection
): ChatModel {
  return createChatProvider(connection)(CHAT_THREAD_TITLE_MODEL_ID);
}
