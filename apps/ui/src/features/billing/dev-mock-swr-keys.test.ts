import { describe, expect, test } from "bun:test";

import { isBillingDevMockSwrKey } from "./dev-mock-swr-keys";

describe("isBillingDevMockSwrKey", () => {
  test("matches every key family the billing fixtures shape", () => {
    for (const key of [
      ["billing-plan-snapshot", "ns-a", "token", "kc"],
      ["billing-account-credits", "kc", "token"],
      ["billing-ai-credits", "kc", "token", "ns-a"],
      ["app-sidebar-subscription", "ns-a", "kc", "token"],
      ["notifications-feed", "ns-a", "kc", "token"],
      ["notifications-topped-up", "kc", "token"],
      ["status-hint-balance", "kc", "token"],
      ["status-hint-quota", "ns-a", "kc", "token"],
      ["chat-free-turns", "ns-a"],
    ]) {
      expect(isBillingDevMockSwrKey(key)).toBe(true);
    }
  });

  test("leaves cluster-bound and unrelated keys alone", () => {
    for (const key of [
      ["/api/notification", "ns-a", "kc"],
      ["workload-logs", "ns-a", "app"],
      "/api/k8s/pods",
      ["projects-explorer"],
      null,
      undefined,
      42,
      [],
    ]) {
      expect(isBillingDevMockSwrKey(key)).toBe(false);
    }
  });
});
