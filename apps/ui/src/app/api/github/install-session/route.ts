import { createGithubAppInstallSessionHandler } from "@/features/deploy/github/connection-http-handlers";
import { createGithubAppInstallSessionUrl } from "@/features/deploy/github/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createGithubAppInstallSessionHandler({
  createSession: createGithubAppInstallSessionUrl,
});
