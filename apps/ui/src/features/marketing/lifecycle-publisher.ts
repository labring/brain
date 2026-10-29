import "server-only";

import { and, asc, eq, inArray, isNull, lt, lte } from "drizzle-orm";

import {
  type AcquisitionClientConfig,
  type AcquisitionFetch,
  acquisitionClientConfig,
  fetchAccountAcquisition,
} from "./acquisition-client";
import { getMarketingDb, type MarketingPgDatabase } from "./db";
import { marketingLifecycleEvents } from "./schema";

const FORWARDABLE_EVENTS = [
  "build_started",
  "deploy_success",
  "new_subscription",
  "topup_success",
] as const;
const MAX_ATTEMPTS = 10;
const PUBLISH_INTERVAL_MS = 60_000;

function lifecycleEnvelope(
  event: typeof marketingLifecycleEvents.$inferSelect,
  realm: "china" | "global"
) {
  return {
    version: 1,
    event_id: event.eventId,
    event_name:
      event.eventName === "new_subscription"
        ? "subscribe_success"
        : event.eventName,
    occurred_at: event.occurredAt.toISOString(),
    subject_id: event.userId,
    workspace_id: event.workspaceId ?? undefined,
    transaction_id: event.transactionId ?? undefined,
    realm,
    properties: {
      deployment_id: event.deploymentId ?? undefined,
      currency: event.currency ?? undefined,
      value: event.value == null ? undefined : Number(event.value),
    },
  };
}

/**
 * Existing SQL-triggered lifecycle rows own the facts. Row locks own delivery;
 * the collector owns event-ID deduplication across a lost acknowledgement.
 */
export async function publishMarketingLifecycleBatch(
  options: {
    config?: AcquisitionClientConfig | null;
    fetch?: AcquisitionFetch;
    getDb?: () => MarketingPgDatabase;
    lookup?: typeof fetchAccountAcquisition;
    now?: () => Date;
    limit?: number;
  } = {}
): Promise<{ delivered: number; failed: number }> {
  const config =
    options.config === undefined ? acquisitionClientConfig() : options.config;
  const counts = { delivered: 0, failed: 0 };
  if (config == null) {
    return counts;
  }
  const db = (options.getDb ?? getMarketingDb)();
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  for (let index = 0; index < limit; index++) {
    const processed = await db.transaction(async (tx) => {
      const now = (options.now ?? (() => new Date()))();
      const [event] = await tx
        .select()
        .from(marketingLifecycleEvents)
        .where(
          and(
            isNull(marketingLifecycleEvents.forwardedAt),
            lt(marketingLifecycleEvents.forwardAttempts, MAX_ATTEMPTS),
            lte(marketingLifecycleEvents.nextForwardAt, now),
            inArray(marketingLifecycleEvents.eventName, [...FORWARDABLE_EVENTS])
          )
        )
        .orderBy(asc(marketingLifecycleEvents.nextForwardAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (event == null) {
        return false;
      }
      let failure = "delivery_failed";
      try {
        const linked =
          event.userId == null
            ? null
            : await (options.lookup ?? fetchAccountAcquisition)(event.userId);
        if (linked == null) {
          failure = "no_analytics_allowed_subject";
          throw new Error(failure);
        }
        const response = await (options.fetch ?? fetch)(
          new URL("/api/analytics/lifecycle", config.baseUrl),
          {
            body: JSON.stringify(lifecycleEnvelope(event, linked.realm)),
            headers: {
              Authorization: `Bearer ${config.secret}`,
              "Content-Type": "application/json",
            },
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(3000),
          }
        );
        if (!response.ok) {
          failure = "collector_rejected";
          throw new Error(failure);
        }
        await tx
          .update(marketingLifecycleEvents)
          .set({
            forwardedAt: now,
            forwardAttempts: event.forwardAttempts + 1,
            lastForwardError: null,
          })
          .where(eq(marketingLifecycleEvents.eventId, event.eventId));
        counts.delivered++;
      } catch {
        await tx
          .update(marketingLifecycleEvents)
          .set({
            forwardAttempts: event.forwardAttempts + 1,
            lastForwardError: failure,
            nextForwardAt: new Date(
              now.getTime() +
                Math.min(3_600_000, 60_000 * 2 ** event.forwardAttempts)
            ),
          })
          .where(eq(marketingLifecycleEvents.eventId, event.eventId));
        counts.failed++;
      }
      return true;
    });
    if (!processed) {
      break;
    }
  }
  return counts;
}

const globalPublisher = globalThis as unknown as {
  __brainMarketingPublisher?: {
    busy: boolean;
    timer: ReturnType<typeof setInterval>;
  };
};

/** Optional analytics never blocks the deployment engine or server startup. */
export function startMarketingLifecyclePublisher(): void {
  if (globalPublisher.__brainMarketingPublisher != null) {
    return;
  }
  try {
    if (acquisitionClientConfig() == null) {
      return;
    }
  } catch {
    console.warn("[marketing-publisher] invalid acquisition configuration");
    return;
  }
  const tick = async () => {
    const runtime = globalPublisher.__brainMarketingPublisher;
    if (runtime == null || runtime.busy) {
      return;
    }
    runtime.busy = true;
    try {
      const result = await publishMarketingLifecycleBatch();
      if (result.failed > 0) {
        console.warn(
          "[marketing-publisher] delivery attempts deferred",
          result.failed
        );
      }
    } catch {
      console.warn("[marketing-publisher] lifecycle batch unavailable");
    } finally {
      runtime.busy = false;
    }
  };
  const timer = setInterval(() => {
    tick().catch(() => undefined);
  }, PUBLISH_INTERVAL_MS);
  timer.unref();
  globalPublisher.__brainMarketingPublisher = { busy: false, timer };
  tick().catch(() => undefined);
}
