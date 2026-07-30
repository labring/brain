import type { AccountServiceClient } from "@/lib/account-service/client-core";
import { appTokenFromRequest } from "@/lib/app-token";
import {
  encodedKubeconfigFromRequest,
  type WorkspaceActorAuthorization,
} from "@/lib/request-kubeconfig-auth";

type AuthorizeWorkspaceActor = (input: {
  appToken: string | undefined;
  encodedKubeconfig: string | undefined;
}) => Promise<WorkspaceActorAuthorization>;

interface BillingAccountHandlerDependencies {
  authorizeWorkspaceActor: AuthorizeWorkspaceActor;
  requestAccountService: AccountServiceClient;
}

function authenticationRequired(): Response {
  return Response.json(
    { error: "Authentication is required." },
    { status: 401 }
  );
}

function isBindingFailure(
  authorization: Extract<WorkspaceActorAuthorization, { ok: false }>
): boolean {
  return (
    authorization.code.startsWith("app_token_") ||
    authorization.code === "workspace_actor_required"
  );
}

export function createBillingAccountHandler({
  authorizeWorkspaceActor,
  requestAccountService,
}: BillingAccountHandlerDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const authorization = await authorizeWorkspaceActor({
      appToken: appTokenFromRequest(request),
      encodedKubeconfig: encodedKubeconfigFromRequest(request),
    });
    if (!authorization.ok) {
      if (isBindingFailure(authorization)) {
        return authenticationRequired();
      }
      return Response.json(
        { error: authorization.message },
        { status: authorization.status }
      );
    }

    const userId = authorization.actorBinding.userId?.trim() ?? "";
    const userUid = authorization.actorBinding.userUid.trim();
    if (userId === "" || userUid === "") {
      return authenticationRequired();
    }

    return await requestAccountService({
      actor: { userId, userUid },
      init: { body: "{}", method: "POST" },
      pathname: "/account/v1alpha1/account",
    });
  };
}
