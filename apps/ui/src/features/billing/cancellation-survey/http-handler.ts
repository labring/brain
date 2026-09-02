import {
  type AuthorizeWorkspaceActor,
  authorizeBillingActor,
} from "@/features/billing/server/authorized-proxy";

import { cancellationSurveyRequestSchema } from "./reasons";
import type { CancellationSurveyStore } from "./store";

export interface CancellationSurveyHandlerDependencies {
  authorizeWorkspaceActor: AuthorizeWorkspaceActor;
  record: CancellationSurveyStore["record"];
}

/**
 * The Cancellation Survey write (ADR-0074). Authorization travels the same
 * verified workspace-actor path as every other billing write, and the
 * actor's global `userUid` is what the row records — no per-region crName
 * (ADR-0059). It fails closed: an unauthorized request writes nothing, and
 * a response filed against a workspace other than the one the actor was
 * verified in is refused, since nothing downstream re-checks it. The cancel
 * itself is not re-verified with account-service, and neither is the
 * actor's OWNER role: the client only submits after a confirmed cancel, and
 * the write is low-stakes feedback, never billing state (ADR-0074). Do not
 * "harden" this into a billing-state read.
 */
export function createCancellationSurveyHandler(
  dependencies: CancellationSurveyHandlerDependencies
) {
  return async function handler(request: Request): Promise<Response> {
    const actor = await authorizeBillingActor(
      request,
      dependencies.authorizeWorkspaceActor
    );
    if (!actor.ok) {
      return actor.response;
    }

    const payload: unknown = await request.json().catch(() => null);
    const parsed = cancellationSurveyRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid cancellation survey response." },
        { status: 400 }
      );
    }
    if (parsed.data.workspace !== actor.namespace) {
      return Response.json(
        { error: "The survey response is not for the current workspace." },
        { status: 403 }
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
        userUid: actor.userUid,
        workspace: parsed.data.workspace,
      });
      return Response.json({ id, ok: true });
    } catch (error) {
      // The client never sees the cause (it swallows the 503); the log is
      // the only place a persistence failure can be diagnosed.
      console.error(
        "[api/billing/subscription/cancellation-survey] persistence unavailable",
        error
      );
      return Response.json(
        { error: "Cancellation survey persistence is unavailable." },
        { status: 503 }
      );
    }
  };
}
