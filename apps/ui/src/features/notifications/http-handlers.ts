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

import { observeWorkspaceQuotaForNotifications } from "./producer-quota-exhausted";
import type { NotificationReader, NotificationStore } from "./store";
import {
  markNotificationReadRequestSchema,
  type NotificationFeedResponse,
  quotaObservationRequestSchema,
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
 * quota observation point. Every handler travels the verified-personal-actor
 * choke point — receipts are uid-keyed rows (ADR-0059) and the stream is
 * namespace-scoped, so both the workspace and the user must be verified.
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
      const authorization = await authorize(request);
      if (!authorization.ok) {
        return authorization.response;
      }
      const body = await request.json().catch(() => null);
      const parsed = markNotificationReadRequestSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError({
          code: "invalid_request",
          message: "Invalid mark-read request.",
          status: 400,
        });
      }
      try {
        await dependencies.store.markRead(
          readerOf(authorization.actor),
          parsed.data.ids
        );
        return Response.json({ read: parsed.data.ids });
      } catch (error) {
        const superseded = supersededBindingResponse(error);
        if (superseded != null) {
          return superseded;
        }
        return unavailable("read", "Could not record the read receipt.");
      }
    },
    observeQuota: async (request: Request): Promise<Response> => {
      const authorization = await authorize(request);
      if (!authorization.ok) {
        return authorization.response;
      }
      const body = await request.json().catch(() => null);
      const parsed = quotaObservationRequestSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError({
          code: "invalid_request",
          message: "Invalid quota observation.",
          status: 400,
        });
      }
      try {
        const result = await observeWorkspaceQuotaForNotifications(
          dependencies.store,
          {
            namespace: authorization.actor.owner.namespace,
            snapshot: parsed.data.quota,
          }
        );
        return Response.json(result);
      } catch {
        return unavailable(
          "quota-observation",
          "Could not record the quota observation."
        );
      }
    },
  };
}
