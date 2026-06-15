import { z } from "zod";
import { resourcePlacementOwner } from "./placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutResourceRef,
  CanvasPlacementOwner,
} from "./types";

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

const canvasLayoutResourceKindSchema = z
  .enum(["AP", "DB", "PublicAccess", "EntryPoint"])
  .transform((kind) => (kind === "EntryPoint" ? "PublicAccess" : kind));

export const canvasLayoutResourceRefSchema = z.object({
  kind: canvasLayoutResourceKindSchema,
  namespace: boundedString,
  name: boundedString,
});

const canvasPlacementOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("resource"),
    ref: canvasLayoutResourceRefSchema,
  }),
  z.object({
    kind: z.literal("deploymentProjection"),
    slotId: boundedString,
    taskId: boundedString,
  }),
]);

function refsEqual(
  a: CanvasLayoutResourceRef,
  b: CanvasLayoutResourceRef
): boolean {
  return a.kind === b.kind && a.name === b.name && a.namespace === b.namespace;
}

interface ParsedCanvasLayoutNodeInput {
  expanded?: boolean;
  lastSeenUid?: string;
  orphanedAt?: string;
  owner?: CanvasPlacementOwner;
  position: { x: number; y: number };
  ref?: CanvasLayoutResourceRef;
  source?: "generated" | "user";
  stackOrder?: number;
}

function normalizedLayoutNodeBase(input: ParsedCanvasLayoutNodeInput) {
  return {
    ...(input.expanded === undefined ? {} : { expanded: input.expanded }),
    ...(input.lastSeenUid === undefined
      ? {}
      : { lastSeenUid: input.lastSeenUid }),
    ...(input.orphanedAt === undefined ? {} : { orphanedAt: input.orphanedAt }),
    position: input.position,
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.stackOrder === undefined ? {} : { stackOrder: input.stackOrder }),
  };
}

function normalizedResourceLayoutNode(
  input: ParsedCanvasLayoutNodeInput,
  owner: Extract<CanvasPlacementOwner, { kind: "resource" }>
): CanvasLayoutNode {
  const ref = input.ref ?? owner.ref;
  if (!refsEqual(ref, owner.ref)) {
    throw new Error("Canvas layout resource owner must match node ref.");
  }
  return {
    ...normalizedLayoutNodeBase(input),
    owner,
    ref,
  };
}

function normalizedDeploymentProjectionLayoutNode(
  input: ParsedCanvasLayoutNodeInput,
  owner: Extract<CanvasPlacementOwner, { kind: "deploymentProjection" }>
): CanvasLayoutNode {
  if (input.ref !== undefined) {
    throw new Error("Deployment projection placement nodes cannot carry ref.");
  }
  return {
    ...normalizedLayoutNodeBase(input),
    owner: {
      kind: "deploymentProjection",
      slotId: owner.slotId,
      taskId: owner.taskId,
    },
  };
}

function normalizedCanvasLayoutNode(
  input: ParsedCanvasLayoutNodeInput
): CanvasLayoutNode {
  const owner =
    input.owner ??
    (input.ref === undefined ? undefined : resourcePlacementOwner(input.ref));
  if (owner === undefined) {
    throw new Error("Canvas layout node owner is required.");
  }
  if (owner.kind === "resource") {
    return normalizedResourceLayoutNode(input, owner);
  }
  return normalizedDeploymentProjectionLayoutNode(input, owner);
}

export const canvasLayoutNodeSchema = z
  .object({
    expanded: z.boolean().optional(),
    lastSeenUid: optionalBoundedString,
    orphanedAt: optionalTimestamp,
    owner: canvasPlacementOwnerSchema.optional(),
    position: z.object({
      x: finiteNumber,
      y: finiteNumber,
    }),
    ref: canvasLayoutResourceRefSchema.optional(),
    source: z.enum(["generated", "user"]).optional(),
    stackOrder: finiteInteger.optional(),
  })
  .transform(normalizedCanvasLayoutNode);

const placementCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    owner: canvasPlacementOwnerSchema,
    position: z.object({ x: finiteNumber, y: finiteNumber }),
    source: z.enum(["generated", "user"]),
  }),
  z.object({
    kind: z.literal("move"),
    owner: canvasPlacementOwnerSchema,
    position: z.object({ x: finiteNumber, y: finiteNumber }),
    source: z.enum(["generated", "user"]),
  }),
  z.object({
    fromOwner: canvasPlacementOwnerSchema,
    kind: z.literal("rekey"),
    toOwner: canvasPlacementOwnerSchema,
  }),
  z.object({
    kind: z.literal("delete"),
    owner: canvasPlacementOwnerSchema,
  }),
]);

export const canvasLayoutDocumentSchema = z.object({
  namespace: boundedString,
  nodes: z.array(canvasLayoutNodeSchema),
  projectNameSnapshot: z.string().trim().max(256).optional(),
  projectId: boundedString,
  version: z.number().int().min(0),
});

export const canvasLayoutPatchRequestSchema = z.object({
  commands: z.array(placementCommandSchema).optional(),
  expectedVersion: z.number().int().min(0).optional(),
  intent: z.enum(["first-placement", "layout"]).optional(),
  namespace: boundedString,
  nodes: z.array(canvasLayoutNodeSchema),
  projectNameSnapshot: z.string().trim().max(256).optional(),
  projectId: boundedString,
});

export const canvasLayoutGetQuerySchema = z.object({
  namespace: boundedString,
  projectId: boundedString,
});

export type CanvasLayoutPatchRequest = z.infer<
  typeof canvasLayoutPatchRequestSchema
>;
export type CanvasLayoutGetQuery = z.infer<typeof canvasLayoutGetQuerySchema>;

export function parseCanvasLayoutDocument(
  input: unknown
): CanvasLayoutDocument {
  return canvasLayoutDocumentSchema.parse(input);
}

export function parseCanvasLayoutPatchRequest(
  input: unknown
): CanvasLayoutPatchRequest {
  return canvasLayoutPatchRequestSchema.parse(input);
}

export function assertCanvasLayoutPatchMatchesOwner(
  input: CanvasLayoutPatchRequest
): void {
  for (const node of input.nodes) {
    const namespace =
      node.owner?.kind === "resource"
        ? node.owner.ref.namespace
        : node.ref?.namespace;
    if (namespace !== undefined && namespace !== input.namespace) {
      throw new Error(
        "Canvas layout node namespace must match layout namespace."
      );
    }
  }
  for (const command of input.commands ?? []) {
    const owners =
      command.kind === "rekey"
        ? [command.fromOwner, command.toOwner]
        : [command.owner];
    for (const owner of owners) {
      if (
        owner.kind === "resource" &&
        owner.ref.namespace !== input.namespace
      ) {
        throw new Error(
          "Canvas layout command namespace must match layout namespace."
        );
      }
    }
  }
}

export function parseCanvasLayoutGetQuery(
  input: unknown
): CanvasLayoutGetQuery {
  return canvasLayoutGetQuerySchema.parse(input);
}
