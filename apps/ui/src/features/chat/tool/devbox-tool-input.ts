import { z } from "zod";
import { chatToolIntentionField } from "./chat-tool-intention";

export const CHAT_DEVBOX_WORKSPACE = "/home/devbox/project/workspace";
const MAX_TEXT_BYTES = 50 * 1024;
const MAX_TEXT_LINES = 2000;
const MAX_EDIT_OPERATIONS = 32;
const MAX_BASH_TIMEOUT_SECONDS = 60;

const safePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !Array.from(value).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ),
    "Path contains control characters."
  );

export const readInputSchema = z
  .object({
    intention: chatToolIntentionField,
    limit: z.number().int().min(1).max(MAX_TEXT_LINES).optional(),
    offset: z.number().int().min(1).optional(),
    path: safePathSchema,
  })
  .strict();

export const writeInputSchema = z
  .object({
    content: z.string(),
    intention: chatToolIntentionField,
    path: safePathSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (new TextEncoder().encode(input.content).length > MAX_TEXT_BYTES) {
      context.addIssue({
        code: "custom",
        message: `File content exceeds ${MAX_TEXT_BYTES} UTF-8 bytes.`,
        path: ["content"],
      });
    }
  });

const editOperationSchema = z
  .object({
    newText: z.string(),
    oldText: z.string().min(1),
  })
  .strict();

export const editInputSchema = z
  .object({
    edits: z.array(editOperationSchema).min(1).max(MAX_EDIT_OPERATIONS),
    intention: chatToolIntentionField,
    path: safePathSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const bytes = input.edits.reduce(
      (total, edit) =>
        total +
        new TextEncoder().encode(edit.oldText).length +
        new TextEncoder().encode(edit.newText).length,
      0
    );
    if (bytes > MAX_TEXT_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Edit content exceeds ${MAX_TEXT_BYTES} UTF-8 bytes.`,
        path: ["edits"],
      });
    }
  });

export const bashInputSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .max(16 * 1024)
      .refine(
        (value) => new TextEncoder().encode(value).length <= 16 * 1024,
        "Command exceeds 16384 UTF-8 bytes."
      ),
    intention: chatToolIntentionField,
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_BASH_TIMEOUT_SECONDS)
      .optional(),
  })
  .strict();
