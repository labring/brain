import {
  createGithubConnectionDeleteHandler,
  createGithubConnectionStatusHandler,
} from "@/features/deploy/github/connection-http-handlers";
import {
  getGithubConnectionStatusForWorkspaceActor,
  revokeGithubConnectionForWorkspaceActor,
} from "@/features/deploy/github/connection-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createGithubConnectionStatusHandler({
  getConnection: getGithubConnectionStatusForWorkspaceActor,
});

export const DELETE = createGithubConnectionDeleteHandler({
  deleteConnection: revokeGithubConnectionForWorkspaceActor,
});
