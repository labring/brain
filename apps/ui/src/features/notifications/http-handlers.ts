import type { z } from "zod";

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

import { observeGiftCreditForNotifications } from "./producer-credit-hint";
import { observeWorkspaceQuotaForNotifications } from "./producer-quota-exhausted";
import { observeSubscriptionChangeForNotifications } from "./producer-subscription-change";
import type { NotificationReader, NotificationStore } from "./store";
import {
  giftObservationRequestSchema,
  markNotificationReadRequestSchema,
  type NotificationFeedResponse,
  quotaObservationRequestSchema,
  subscriptionChangeObservationRequestSchema,
} from "./types";

export interface NotificationHandlerDependencies {
  /** Test seam; defaults to `JWT_INTERNAL` from the env. */
  appTokenConfig?: AppTokenVerificationConfig | null;
  /** Test seam; defaults to the region-local Identity Fingerprint store. */
  observeFingerprint?: ObserveIdentityFingerprint;
  store: NotificationStore;
  verify?: VerifyKubeconfigNamespace;
}

function readerOf(actor: VerifiedPersonalResourceActor): NotificationReader {
  return {
    legacyWorkspaceActor: actor.legacyWorkspaceActor,
    namespace: actor.owner.namespace,
    userUid: actor.owner.userUid,
  };
}

function unavailable(route: string, message: string): Response {
  console.error(`[api/notifications/${route}] persistence unavailable`);
  return jsonError({
    code: "notifications_unavailable",
    message,
    status: 503,
  });
}

/**
 * The Notification Center's Brain-side HTTP surface (ADR-0067): the `db:`
 * stream plus the user's receipts, the per-user mark-read write, and the
 * producers' observation points (quota, gift credit, subscription change).
 * Every handler travels the verified-personal-actor choke point — receipts
 * are uid-keyed rows (ADR-0059) and the stream is namespace-scoped, so both
 * the workspace and the user must be verified.
 */
export function createNotificationHandlers(
  dependencies: NotificationHandlerDependencies
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

  /** Verify the actor, then parse the JSON body; a bad body is a 400. */
  const authorizeBody = async <T>(
    request: Request,
    schema: z.ZodType<T>,
    message: string
  ): Promise<
    | { ok: true; actor: VerifiedPersonalResourceActor; input: T }
    | { ok: false; response: Response }
  > => {
    const authorization = await authorize(request);
    if (!authorization.ok) {
      return authorization;
    }
    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        response: jsonError({ code: "invalid_request", message, status: 400 }),
      };
    }
    return { actor: authorization.actor, input: parsed.data, ok: true };
  };

  /**
   * Every producer's observation point has one shape: verify the actor,
   * parse the body, hand the verified namespace (and user) to the producer,
   * answer its result. A persistence failure is a 503, never a crash.
   */
  const observation =
    <T>(config: {
      message: string;
      produce: (
        actor: VerifiedPersonalResourceActor,
        input: T
      ) => Promise<unknown>;
      route: string;
      schema: z.ZodType<T>;
      unavailableMessage: string;
    }) =>
    async (request: Request): Promise<Response> => {
      const authorized = await authorizeBody(
        request,
        config.schema,
        config.message
      );
      if (!authorized.ok) {
        return authorized.response;
      }
      try {
        return Response.json(
          await config.produce(authorized.actor, authorized.input)
        );
      } catch {
        return unavailable(config.route, config.unavailableMessage);
      }
    };

  return {
    feed: async (request: Request): Promise<Response> => {
      const authorization = await authorize(request);
      if (!authorization.ok) {
        return authorization.response;
      }
      const reader = readerOf(authorization.actor);
      try {
        const [messages, receipts] = await Promise.all([
          dependencies.store.listMessages(reader.namespace),
          dependencies.store.listReceipts(reader.userUid),
        ]);
        const body: NotificationFeedResponse = { messages, receipts };
        return Response.json(body);
      } catch {
        return unavailable("feed", "Notifications are unavailable.");
      }
    },
    markRead: async (request: Request): Promise<Response> => {
      const authorized = await authorizeBody(
        request,
        markNotificationReadRequestSchema,
        "Invalid mark-read request."
      );
      if (!authorized.ok) {
        return authorized.response;
      }
      const { ids } = authorized.input;
      try {
        await dependencies.store.markRead(readerOf(authorized.actor), ids);
        return Response.json({ read: ids });
      } catch (error) {
        const superseded = supersededBindingResponse(error);
        if (superseded != null) {
          return superseded;
        }
        return unavailable("read", "Could not record the read receipt.");
      }
    },
    observeGift: observation({
      message: "Invalid gift observation.",
      produce: (actor, input) =>
        observeGiftCreditForNotifications(dependencies.store, {
          ...input,
          namespace: actor.owner.namespace,
          userUid: actor.owner.userUid,
        }),
      route: "gift-observation",
      schema: giftObservationRequestSchema,
      unavailableMessage: "Could not record the gift observation.",
    }),
    observeQuota: observation({
      message: "Invalid quota observation.",
      produce: (actor, input) =>
        observeWorkspaceQuotaForNotifications(dependencies.store, {
          namespace: actor.owner.namespace,
          snapshot: input.quota,
        }),
      route: "quota-observation",
      schema: quotaObservationRequestSchema,
      unavailableMessage: "Could not record the quota observation.",
    }),
    observeSubscriptionChange: observation({
      message: "Invalid subscription-change observation.",
      produce: (actor, input) =>
        observeSubscriptionChangeForNotifications(dependencies.store, {
          ...input,
          namespace: actor.owner.namespace,
        }),
      route: "subscription-change",
      schema: subscriptionChangeObservationRequestSchema,
      unavailableMessage: "Could not record the subscription change.",
    }),
  };
}
