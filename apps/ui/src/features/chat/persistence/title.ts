import "server-only";

import { generateText, type UIMessage } from "ai";

type ChatTitleModel = Parameters<typeof generateText>[0]["model"];

const SYSTEM_PROMPT =
  "Reply with only a short conversation title (maximum 6 words). No quotation marks. No trailing period. Summarize the user's topic. When a current project is given and the topic concerns it, include the project name in the title.";

const LEADING_QUOTES = /^["'「『]+/;
const TRAILING_QUOTES = /["'」』]+$/;
const WHITESPACE_RUN = /\s+/g;
const SPLIT_WORDS = /\s+/;

const FIRST_USER_PROMPT_CHARS = 800;
/**
 * Must leave room beyond internal reasoning. With a low ceiling, reasoning-heavy
 * models hit `finishReason: "length"` with `textTokens: 0` and empty `content`.
 */
const TITLE_MAX_OUTPUT_TOKENS = 512;
const MAX_TITLE_LEN = 80;
const FALLBACK_WORDS = 8;
const FALLBACK_HARD_LEN = 60;
const FALLBACK_TRIM_LEN = 57;

function joinTextContentParts(
  parts: ReadonlyArray<{ type?: string; text?: unknown }> | undefined
): string {
  if (parts == null) {
    return "";
  }
  const chunks: string[] = [];
  for (const p of parts) {
    if (
      p?.type === "text" &&
      typeof p.text === "string" &&
      p.text.trim() !== ""
    ) {
      chunks.push(p.text.trim());
    }
  }
  return chunks.join(" ").trim();
}

/** Prefer top-level `text`; gateways / reasoning flows often omit it. */
function rawTitleFromGenerateTextResult(result: {
  readonly text: string;
  readonly content: ReadonlyArray<{ type?: string; text?: unknown }>;
  readonly reasoningText: string | undefined;
  readonly steps: ReadonlyArray<{
    readonly text?: string;
    readonly content?: ReadonlyArray<{ type?: string; text?: unknown }>;
  }>;
}): string {
  const direct = result.text.trim();
  if (direct !== "") {
    return direct;
  }
  const fromParts = joinTextContentParts(result.content);
  if (fromParts !== "") {
    return fromParts;
  }
  const fromReason =
    typeof result.reasoningText === "string" ? result.reasoningText.trim() : "";
  if (fromReason !== "") {
    return fromReason;
  }
  const last = result.steps.at(-1);
  if (last != null) {
    const stepText = typeof last.text === "string" ? last.text.trim() : "";
    if (stepText !== "") {
      return stepText;
    }
    const stepParts = joinTextContentParts(last.content);
    if (stepParts !== "") {
      return stepParts;
    }
  }
  return "";
}

/** Date-stamped placeholder used until the AI title replaces it after the first turn. */
export function placeholderThreadTitle(date = new Date()): string {
  return `chat-${date.toISOString().slice(0, 10)}`;
}

function firstUserText(messages: UIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user" || !Array.isArray(m.parts)) {
      continue;
    }
    for (const p of m.parts) {
      if (
        p &&
        typeof p === "object" &&
        "type" in p &&
        p.type === "text" &&
        "text" in p &&
        typeof (p as { text: unknown }).text === "string"
      ) {
        const text = (p as { text: string }).text.trim();
        if (text !== "") {
          return text;
        }
      }
    }
  }
  return "";
}

function fallbackTitle(firstUserMessage: string): string {
  const words = firstUserMessage
    .trim()
    .split(SPLIT_WORDS)
    .slice(0, FALLBACK_WORDS)
    .join(" ");
  const shortened =
    words.length > FALLBACK_HARD_LEN
      ? `${words.slice(0, FALLBACK_TRIM_LEN).trim()}…`
      : words;
  return shortened.trim() === "" ? "Chat" : shortened;
}

/**
 * Concise title from the first user turn. Falls back to a heuristic if the model
 * call fails so the caller never has to handle an error path. `projectName` is
 * the display name of the project the user was viewing when the thread started —
 * a known fact handed to the model, not something it must infer from the text.
 */
export async function deriveThreadTitle(input: {
  abortSignal?: AbortSignal;
  languageModel: ChatTitleModel;
  messages: UIMessage[];
  projectName?: string;
}): Promise<string> {
  const first = firstUserText(input.messages);
  if (first === "") {
    return fallbackTitle("");
  }
  const projectName = input.projectName?.trim() ?? "";
  const userPart = first.slice(0, FIRST_USER_PROMPT_CHARS);
  try {
    const generated = await generateText({
      abortSignal: input.abortSignal,
      model: input.languageModel,
      instructions: SYSTEM_PROMPT,
      prompt:
        projectName === ""
          ? userPart
          : `Current project: ${projectName}\n\n${userPart}`,
      maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
    });
    const raw = rawTitleFromGenerateTextResult(generated);
    const cleaned = raw
      .trim()
      .replace(LEADING_QUOTES, "")
      .replace(TRAILING_QUOTES, "")
      .replace(WHITESPACE_RUN, " ");
    if (cleaned !== "") {
      return cleaned.slice(0, MAX_TITLE_LEN);
    }
  } catch (e) {
    console.error("[chat-persistence] title generation failed:", e);
  }
  return fallbackTitle(first);
}
