import { z } from "zod";

import { sessionWorkspaceSchema } from "@/features/session/session-schema";

/**
 * `GET /api/workspace/list` answers the user's Workspaces in this region as
 * a bare array in the Brain Session's own Workspace shape (spec §B.2, same
 * as `/api/session`'s `workspaces`), Desktop's order, Personal first.
 */
export const workspaceListResponseSchema = z.array(sessionWorkspaceSchema);

export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;
