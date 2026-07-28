import {
  createGithubConnectionDeleteHandler,
  createGithubConnectionStatusHandler,
} from "@/features/deploy/github/connection-http-handlers";
import {
  adoptLegacyGithubConnectionForOwner,
  getGithubConnectionStatusForOwner,
  revokeGithubConnectionForOwner,
} from "@/features/deploy/github/connection-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createGithubConnectionStatusHandler({
  adoptLegacyConnection: adoptLegacyGithubConnectionForOwner,
  getConnection: getGithubConnectionStatusForOwner,
});

export const DELETE = createGithubConnectionDeleteHandler({
  adoptLegacyConnection: adoptLegacyGithubConnectionForOwner,
  deleteConnection: revokeGithubConnectionForOwner,
});
