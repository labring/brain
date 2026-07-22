import { createGithubOAuthSessionHandler } from "@/features/deploy/github/connection-http-handlers";
import { createGithubOAuthSessionUrl } from "@/features/deploy/github/service";
import { getCallbackBaseUrl } from "@/features/deploy/github/urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createGithubOAuthSessionHandler({
  createSession: createGithubOAuthSessionUrl,
  getBaseUrl: getCallbackBaseUrl,
});
