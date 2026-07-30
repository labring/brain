import { z } from "zod";

export const billingWorkspaceRequestSchema = z.object({
  regionDomain: z.string().trim().min(1),
  workspace: z.string().trim().min(1),
});

export const billingTimeRangeRequestSchema = z.object({
  endTime: z.iso.datetime(),
  startTime: z.iso.datetime(),
});
