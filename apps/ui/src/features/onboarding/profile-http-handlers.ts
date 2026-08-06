import type { AppTokenVerificationConfig } from "@/lib/app-token";
import type { ObserveIdentityFingerprint } from "@/lib/identity-fingerprint-core";
import {
  authorizePersonalResourceRequest,
  jsonError,
  supersededBindingResponse,
} from "@/lib/personal-resource-http";
import type { VerifyKubeconfigNamespace } from "@/lib/request-kubeconfig-auth";
import {
  type VerifiedPersonalResourceActor,
  verifiedPersonalResourceActor,
} from "@/lib/verified-personal-actor";

import type {
  OnboardingProfileActor,
  OnboardingProfileStore,
  OnboardingStepAnswerColumns,
} from "./profile-store";
import {
  type AnswerOnboardingStepRequest,
  answerOnboardingStepRequestSchema,
  completeOnboardingProfileRequestSchema,
  dismissOnboardingProfileRequestSchema,
} from "./types";

export interface OnboardingProfileHandlerDependencies {
  answerStep: OnboardingProfileStore["answerStep"];
  /** Test seam; defaults to `JWT_INTERNAL` from the env. */
  appTokenConfig?: AppTokenVerificationConfig | null;
  complete: OnboardingProfileStore["complete"];
  dismiss: OnboardingProfileStore["dismiss"];
  isSampled: OnboardingProfileStore["isSampled"];
  /** Test seam; defaults to the region-local Identity Fingerprint store. */
  observeFingerprint?: ObserveIdentityFingerprint;
  verify?: VerifyKubeconfigNamespace;
}

/** Maps one step's request onto the columns it owns. */
function stepAnswerColumns(
  request: AnswerOnboardingStepRequest
): OnboardingStepAnswerColumns {
  switch (request.step) {
    case 1:
      return {
        roleOtherText: request.roleOtherText,
        roleType: request.roleType,
      };
    case 2:
      return {
        usageContext: request.usageContext,
        usageOtherText: request.usageOtherText,
      };
    case 3:
      return {
        priorityDisplayOrder: request.priorityDisplayOrder,
        priorityOtherText: request.priorityOtherText,
        priorityTags: request.priorityTags,
      };
    default:
      return request satisfies never;
  }
}

/** Maps the verified actor onto the store's bare-uid + re-check pair. */
function profileActor(
  actor: VerifiedPersonalResourceActor
): OnboardingProfileActor {
  return {
    legacyWorkspaceActor: actor.legacyWorkspaceActor,
    userUid: actor.owner.userUid,
  };
}

/**
 * The Onboarding Profile's HTTP surface (ADR-0061). Both handlers travel the
 * verified-personal-actor choke point unchanged — no lighter uid-only path,
 * no dev bypass — and fail closed: an unauthorized or failing request yields
 * an error the Onboarding Gate silently treats as "no dialog".
 */
export function createOnboardingProfileHandlers(
  dependencies: OnboardingProfileHandlerDependencies
) {
  const authorize = async (
    request: Request
  ): Promise<
    | { ok: true; actor: VerifiedPersonalResourceActor }
    | { ok: false; response: Response }
  > => {
    const result = await authorizePersonalResourceRequest(request, {
      appTokenConfig: dependencies.appTokenConfig,
      observeFingerprint: dependencies.observeFingerprint,
      verify: dependencies.verify,
    });
    return result.ok
      ? { actor: verifiedPersonalResourceActor(result.authorization), ok: true }
      : result;
  };

  return {
    answerStep: async (request: Request): Promise<Response> => {
      const authorization = await authorize(request);
      if (!authorization.ok) {
        return authorization.response;
      }
      const body = await request.json().catch(() => null);
      const parsed = answerOnboardingStepRequestSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError({
          code: "invalid_request",
          message: "Invalid onboarding step answer.",
          status: 400,
        });
      }
      try {
        const state = await dependencies.answerStep({
          actor: profileActor(authorization.actor),
          answers: stepAnswerColumns(parsed.data),
        });
        return Response.json(state);
      } catch (error) {
        const superseded = supersededBindingResponse(error);
        if (superseded != null) {
          return superseded;
        }
        console.error("[api/onboarding-profile/step] persistence unavailable");
        return jsonError({
          code: "onboarding_profile_unavailable",
          message: "Onboarding profile persistence is unavailable.",
          status: 503,
        });
      }
    },
    complete: async (request: Request): Promise<Response> => {
      const authorization = await authorize(request);
      if (!authorization.ok) {
        return authorization.response;
      }
      const body = await request.json().catch(() => null);
      const parsed = completeOnboardingProfileRequestSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError({
          code: "invalid_request",
          message: "Invalid onboarding complete request.",
          status: 400,
        });
      }
      try {
        const state = await dependencies.complete({
          actor: profileActor(authorization.actor),
          openGoalText: parsed.data.openGoalText,
        });
        return Response.json(state);
      } catch (error) {
        const superseded = supersededBindingResponse(error);
        if (superseded != null) {
          return superseded;
        }
        console.error(
          "[api/onboarding-profile/complete] persistence unavailable"
        );
        return jsonError({
          code: "onboarding_profile_unavailable",
          message: "Onboarding profile persistence is unavailable.",
          status: 503,
        });
      }
    },
    dismiss: async (request: Request): Promise<Response> => {
      const authorization = await authorize(request);
      if (!authorization.ok) {
        return authorization.response;
      }
      const body = await request.json().catch(() => null);
      const parsed = dismissOnboardingProfileRequestSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError({
          code: "invalid_request",
          message: "Invalid onboarding dismiss request.",
          status: 400,
        });
      }
      try {
        const state = await dependencies.dismiss({
          actor: profileActor(authorization.actor),
          dismissedAtStep: parsed.data.dismissedAtStep,
        });
        return Response.json(state);
      } catch (error) {
        const superseded = supersededBindingResponse(error);
        if (superseded != null) {
          return superseded;
        }
        console.error(
          "[api/onboarding-profile/dismiss] persistence unavailable"
        );
        return jsonError({
          code: "onboarding_profile_unavailable",
          message: "Onboarding profile persistence is unavailable.",
          status: 503,
        });
      }
    },
    sampling: async (request: Request): Promise<Response> => {
      const authorization = await authorize(request);
      if (!authorization.ok) {
        return authorization.response;
      }
      try {
        const sampled = await dependencies.isSampled(
          authorization.actor.owner.userUid
        );
        return Response.json({ sampled });
      } catch {
        console.error(
          "[api/onboarding-profile/sampling] persistence unavailable"
        );
        return jsonError({
          code: "onboarding_profile_unavailable",
          message: "Onboarding sampling is unavailable.",
          status: 503,
        });
      }
    },
  };
}
