import { createGithubRepositoryListHandler } from "@/features/deploy/github/connection-http-handlers";
import { listGithubReposForWorkspaceActor } from "@/features/deploy/github/connection-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createGithubRepositoryListHandler({
  listRepositories: listGithubReposForWorkspaceActor,
});
