import { z } from "zod";

const billingTimeRangeRequestSchema = z.object({
  endTime: z.iso.datetime(),
  startTime: z.iso.datetime(),
});

function datedRequest<TShape extends z.ZodRawShape>(shape: TShape) {
  return z
    .object({ ...billingTimeRangeRequestSchema.shape, ...shape })
    .strict()
    .refine(
      (value) => {
        const { endTime, startTime } = value as {
          endTime: string;
          startTime: string;
        };
        return new Date(startTime).getTime() <= new Date(endTime).getTime();
      },
      { message: "startTime must not be after endTime." }
    );
}

export const billingCostRequestSchemas = {
  appCosts: datedRequest({
    appName: z.string(),
    appType: z.string(),
    namespace: z.string().trim().min(1),
    orderID: z.string(),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
  }),
  appOverview: datedRequest({
    appName: z.string(),
    appType: z.string(),
    namespace: z.string(),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
  }),
  appTypes: z.object({}).strict(),
  consumption: datedRequest({
    appName: z.string(),
    appType: z.string(),
    namespace: z.string(),
  }),
  costs: datedRequest({}),
  payments: datedRequest({}),
  workspaceConsumption: datedRequest({}),
  workspaces: datedRequest({ type: z.literal(0) }),
} as const;
