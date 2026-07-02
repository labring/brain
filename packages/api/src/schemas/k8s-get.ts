import { z } from "zod";

/**
 * Query params for `GET /api/k8s/v1alpha1/get` — matches `registerGet` `getInput` in
 * `apps/api/route/k8s/query.go` (auth is via `Authorization`, not query).
 */
export const k8sGetQuerySchema = z.object({
  kind: z.string().min(1),
  name: z.string().optional(),
  namespace: z.string().optional(),
  "label-selector": z.string().optional(),
  "field-selector": z.string().optional(),
});

export type K8sGetQuery = z.infer<typeof k8sGetQuerySchema>;

/**
 * JSON body from the k8s get route (`json.RawMessage` from the API).
 * Lists expose `items`; some clients wrap list data under `data`.
 */
export const k8sGetResponseSchema = z
  .object({
    items: z.array(z.unknown()).optional(),
    data: z
      .object({
        items: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type K8sGetResponse = z.infer<typeof k8sGetResponseSchema>;
