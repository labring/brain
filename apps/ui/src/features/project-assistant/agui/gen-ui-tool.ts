import { formatSpecIssues, type Spec, validateSpec } from "@json-render/core";
import { z } from "zod";

import { catalog } from "./catalog";

const specElementSchema = z.object({
  type: z.string(),
  props: z.record(z.string(), z.unknown()),
  children: z.array(z.string()),
});

/** Input the model fills to produce a conforming json-render `Spec`. */
export const genUISpecInputSchema = z.object({
  spec: z.object({
    root: z.string(),
    elements: z.record(z.string(), specElementSchema),
  }),
});

export type EmitGenUISpecToolOutput =
  | {
      ok: true;
      spec: Spec;
    }
  | {
      ok: false;
      spec: Spec;
      validationMessage: string;
    };

export function buildEmitGenUISpecDescription(): string {
  return [
    "Emit a UI spec rendered by the app from the bounded component catalog.",
    "Call when the user asks for dashboard metrics, charts, or catalog-backed UI.",
    "Pass a complete spec: { root: string, elements: { [id]: { type, props, children } } }; `root` must be a key of `elements`.",
    "",
    "--- Catalog (AUTHORITATIVE) ---",
    catalog.prompt(),
  ].join("\n");
}

export function executeEmitGenUISpec(input: {
  spec: {
    root: string;
    elements: Record<
      string,
      {
        type: string;
        props: Record<string, unknown>;
        children: string[];
      }
    >;
  };
}): EmitGenUISpecToolOutput {
  const cast = input.spec as Spec;
  const result = validateSpec(cast);
  if (!result.valid) {
    return {
      ok: false,
      spec: cast,
      validationMessage: formatSpecIssues(result.issues),
    };
  }
  return { ok: true, spec: cast };
}
