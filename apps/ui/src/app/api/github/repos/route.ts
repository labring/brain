import { createGithubRepositoryListHandler } from "@/features/deploy/github/connection-http-handlers";
import {
  adoptLegacyGithubConnectionForOwner,
  listGithubReposForOwner,
} from "@/features/deploy/github/connection-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createGithubRepositoryListHandler({
  adoptLegacyConnection: adoptLegacyGithubConnectionForOwner,
  listRepositories: listGithubReposForOwner,
});
