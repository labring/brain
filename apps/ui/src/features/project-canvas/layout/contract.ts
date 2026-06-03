import { z } from "zod";
import type { CanvasLayoutDocument } from "./types";

const boundedString = z.string().trim().min(1).max(256);
const finiteNumber = z.number().refine((value) => Number.isFinite(value), {
  message: "Expected a finite number.",
});
const finiteInteger = finiteNumber.int();
const optionalBoundedString = z.string().trim().max(256).optional();
const optionalTimestamp = z
  .string()
  .trim()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected a valid date.",
  })
  .optional();

export const canvasLayoutResourceRefSchema = z.object({
  kind: z.enum(["AP", "DB", "EntryPoint"]),
  namespace: boundedString,
  name: boundedString,
});

export const canvasLayoutNodeSchema = z.object({
  expanded: z.boolean().optional(),
  lastSeenUid: optionalBoundedString,
  orphanedAt: optionalTimestamp,
  position: z.object({
    x: finiteNumber,
    y: finiteNumber,
  }),
  ref: canvasLayoutResourceRefSchema,
  stackOrder: finiteInteger.optional(),
});

export const canvasLayoutDocumentSchema = z.object({
  namespace: boundedString,
  nodes: z.array(canvasLayoutNodeSchema),
  projectId: boundedString.optional(),
  projectNameSnapshot: z.string().trim().max(256).optional(),
  projectUid: boundedString,
  version: z.number().int().min(0),
});

export const canvasLayoutPatchRequestSchema = z.object({
  namespace: boundedString,
  nodes: z.array(canvasLayoutNodeSchema),
  projectId: boundedString.optional(),
  projectNameSnapshot: z.string().trim().max(256).optional(),
  projectUid: boundedString.optional(),
});

export const canvasLayoutGetQuerySchema = z.object({
  namespace: boundedString,
  projectId: boundedString.optional(),
  projectUid: boundedString.optional(),
});

export type CanvasLayoutPatchRequest = z.infer<
  typeof canvasLayoutPatchRequestSchema
>;
export type CanvasLayoutGetQuery = z.infer<typeof canvasLayoutGetQuerySchema>;

export function parseCanvasLayoutDocument(
  input: unknown
): CanvasLayoutDocument {
  const parsed = canvasLayoutDocumentSchema.parse(input);
  const projectId = parsed.projectId ?? parsed.projectUid;
  return { ...parsed, projectId, projectUid: projectId };
}

export function parseCanvasLayoutPatchRequest(
  input: unknown
): CanvasLayoutPatchRequest {
  const parsed = canvasLayoutPatchRequestSchema.parse(input);
  const projectId = parsed.projectId ?? parsed.projectUid;
  if (projectId === undefined || projectId.trim() === "") {
    throw new Error("Canvas layout projectId is required.");
  }
  return { ...parsed, projectId, projectUid: projectId };
}

export function assertCanvasLayoutPatchMatchesOwner(
  input: CanvasLayoutPatchRequest
): void {
  for (const node of input.nodes) {
    if (node.ref.namespace !== input.namespace) {
      throw new Error(
        "Canvas layout node namespace must match layout namespace."
      );
    }
  }
}

export function parseCanvasLayoutGetQuery(
  input: unknown
): CanvasLayoutGetQuery {
  const parsed = canvasLayoutGetQuerySchema.parse(input);
  const projectId = parsed.projectId ?? parsed.projectUid;
  if (projectId === undefined || projectId.trim() === "") {
    throw new Error("Canvas layout projectId is required.");
  }
  return { ...parsed, projectId, projectUid: projectId };
}
