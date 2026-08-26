import { clearChatGithubCredentialsForActor } from "@/features/chat/devbox/github-credentials";
import {
  createGithubConnectionDeleteHandler,
  createGithubConnectionStatusHandler,
} from "@/features/deploy/github/connection-http-handlers";
import {
  adoptLegacyGithubConnectionForOwner,
  beginGithubConnectionRevocationForActor,
  getGithubConnectionStatusForOwner,
  revokeGithubConnectionsForActor,
} from "@/features/deploy/github/connection-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createGithubConnectionStatusHandler({
  adoptLegacyConnection: adoptLegacyGithubConnectionForOwner,
  getConnection: getGithubConnectionStatusForOwner,
});

export const DELETE = createGithubConnectionDeleteHandler({
  beginRevocation: beginGithubConnectionRevocationForActor,
  clearRuntimeCredentials: async (actor) => {
    await clearChatGithubCredentialsForActor({
      namespace: actor.owner.namespace,
      workspaceUserUid: actor.owner.userUid,
    });
  },
  deleteConnection: revokeGithubConnectionsForActor,
});
