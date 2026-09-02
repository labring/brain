import {
  type AuthorizeWorkspaceActor,
  authenticationRequired,
  isBindingFailure,
} from "@/features/billing/server/authorized-proxy";
import { appTokenFromRequest } from "@/lib/app-token";
import { encodedKubeconfigFromRequest } from "@/lib/request-kubeconfig-auth";

import { cancellationSurveyRequestSchema } from "./reasons";
import type { CancellationSurveyStore } from "./store";

export interface CancellationSurveyHandlerDependencies {
  authorizeWorkspaceActor: AuthorizeWorkspaceActor;
  record: CancellationSurveyStore["record"];
}

/**
 * The Cancellation Survey write (ADR-0072). Authorization travels the same
 * verified workspace-actor path as every other billing write, and the
 * actor's global `userUid` is what the row records — no per-region crName
 * (ADR-0059). It fails closed: an unauthorized request writes nothing. The
 * cancel itself is not re-verified with account-service; the client only
 * submits after a confirmed cancel, and the write is low-stakes feedback,
 * never billing state.
 */
export function createCancellationSurveyHandler(
  dependencies: CancellationSurveyHandlerDependencies
) {
  return async function handler(request: Request): Promise<Response> {
    const authorization = await dependencies.authorizeWorkspaceActor({
      appToken: appTokenFromRequest(request),
      encodedKubeconfig: encodedKubeconfigFromRequest(request),
    });
    if (!authorization.ok) {
      return isBindingFailure(authorization)
        ? authenticationRequired()
        : Response.json(
            { error: authorization.message },
            { status: authorization.status }
          );
    }
    // Only the global uid is recorded (ADR-0059); unlike the proxy, no
    // legacy userId is needed because nothing is forwarded to account-service.
    const userUid = authorization.actorBinding.userUid.trim();
    if (userUid === "") {
      return authenticationRequired();
    }

    const payload: unknown = await request.json().catch(() => null);
    const parsed = cancellationSurveyRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid cancellation survey response." },
        { status: 400 }
      );
    }

    try {
      const { id } = await dependencies.record({
        currentPeriodEndAt:
          parsed.data.currentPeriodEndAt == null
            ? null
            : new Date(parsed.data.currentPeriodEndAt),
        feedback: parsed.data.feedback,
        planName: parsed.data.planName,
        reasons: parsed.data.reasons,
        regionDomain: parsed.data.regionDomain,
        userUid,
        workspace: parsed.data.workspace,
      });
      return Response.json({ id, ok: true });
    } catch {
      console.error(
        "[api/billing/subscription/cancellation-survey] persistence unavailable"
      );
      return Response.json(
        { error: "Cancellation survey persistence is unavailable." },
        { status: 503 }
      );
    }
  };
}
