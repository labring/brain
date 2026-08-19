import assert from "node:assert/strict";
import { test } from "node:test";

import { loadBillingPricing } from "./billing-pricing-data";

test("loads plan and metered pricing for the current PAYG workspace", async () => {
  const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
  const responses: Record<string, unknown> = {
    "/api/billing/plans": {
      plans: [
        {
          AIQuota: 0,
          Description: "For growing workloads",
          ID: "plan-pro",
          MaxResources: '{"cpu":"4","memory":"8Gi","gpu":"1"}',
          MaxSeats: 5,
          Name: "Pro",
          Order: 2,
          Prices: [
            {
              BillingCycle: "1m",
              OriginalPrice: 25_000_000,
              Price: 20_000_000,
            },
          ],
          Tags: ["more"],
          Traffic: 100,
        },
        {
          AIQuota: 20_000_000,
          Description: "For personal projects",
          ID: "plan-starter",
          MaxResources: '{"cpu":"2","memory":"4Gi"}',
          MaxSeats: 1,
          Name: "Starter",
          Order: 1,
          Prices: [{ BillingCycle: "1m", OriginalPrice: 0, Price: 5_000_000 }],
          Tags: [],
          Traffic: 50,
        },
      ],
    },
    "/api/billing/properties": {
      data: {
        // Raw upstream units describe the unit_price granularity ("1m",
        // "1Mi"); display must use the normalized per-vCPU/per-GiB units.
        properties: [
          { name: "network", unit: "1Mi", unit_price: 2 },
          {
            name: "gpu-a100",
            alias: "NVIDIA A100",
            unit: "gpu",
            unit_price: 750_000,
          },
          { name: "storage", unit: "1Mi", unit_price: 5 },
          { name: "memory", unit: "1Mi", unit_price: 20 },
          { name: "cpu", unit: "1m", unit_price: 10 },
          { name: "services.nodeports", unit: "", unit_price: 1000 },
        ],
      },
    },
    "/api/billing/regions": {
      current: { domain: "us.example.test", uid: "region-us" },
    },
    "/api/billing/subscription": {
      subscription: { type: "PAYG" },
    },
  };

  const snapshot = await loadBillingPricing(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input, init) => {
        const url = new URL(input.toString(), "https://brain.example.test");
        requests.push({
          body: init?.body == null ? null : JSON.parse(init.body.toString()),
          headers: new Headers(init?.headers),
          url: url.pathname,
        });
        const response = responses[url.pathname];
        assert.notEqual(
          response,
          undefined,
          `fixture exists for ${url.pathname}`
        );
        return Promise.resolve(Response.json(response));
      },
    }
  );

  assert.equal(snapshot.isPayg, true);
  assert.deepEqual(
    snapshot.plans.map((plan) => ({
      monthlyPriceMicroUnits: plan.monthlyPriceMicroUnits,
      monthlyOriginalPriceMicroUnits: plan.monthlyOriginalPriceMicroUnits,
      name: plan.name,
      resources: plan.resources.map((resource) => resource.label),
      tags: plan.tags,
    })),
    [
      {
        monthlyPriceMicroUnits: 5_000_000,
        monthlyOriginalPriceMicroUnits: 0,
        name: "Starter",
        resources: ["CPU", "Memory", "Traffic", "AI Credits"],
        tags: [],
      },
      {
        monthlyPriceMicroUnits: 20_000_000,
        monthlyOriginalPriceMicroUnits: 25_000_000,
        name: "Pro",
        resources: ["CPU", "Memory", "GPU", "Traffic", "Seats"],
        tags: ["more"],
      },
    ]
  );
  assert.deepEqual(
    snapshot.plans[0]?.resources.find((resource) => resource.type === "ai"),
    { label: "AI Credits", type: "ai", value: "2,000" }
  );
  assert.deepEqual(
    snapshot.prices.map((price) => ({
      hourlyPriceMicroUnits: price.hourlyPriceMicroUnits,
      label: price.label,
      billingBasis: price.billingBasis,
      type: price.type,
      unit: price.unit,
    })),
    [
      {
        hourlyPriceMicroUnits: 10_000,
        label: "CPU",
        billingBasis: "duration",
        type: "cpu",
        unit: "vCPU",
      },
      {
        hourlyPriceMicroUnits: 20_480,
        label: "Memory",
        billingBasis: "duration",
        type: "memory",
        unit: "GiB",
      },
      {
        hourlyPriceMicroUnits: 5120,
        label: "Storage",
        billingBasis: "duration",
        type: "storage",
        unit: "GiB",
      },
      {
        hourlyPriceMicroUnits: 750_000,
        label: "NVIDIA A100",
        billingBasis: "duration",
        type: "gpu",
        unit: "GPU",
      },
      {
        hourlyPriceMicroUnits: 2,
        label: "Network traffic",
        billingBasis: "quantity",
        type: "network",
        unit: "MiB",
      },
      {
        hourlyPriceMicroUnits: 1000,
        label: "Public ports",
        billingBasis: "duration",
        type: "nodeport",
        unit: "port",
      },
    ]
  );

  assert.equal(requests.length, 4);
  const subscriptionRequest = requests.find(
    (request) => request.url === "/api/billing/subscription"
  );
  assert.deepEqual(subscriptionRequest?.body, {
    regionDomain: "us.example.test",
    workspace: "workspace-a",
  });
  for (const request of requests) {
    assert.equal(
      request.headers.get("X-Sealos-App-Token"),
      "desktop-app-token"
    );
    assert.equal(
      request.headers.get("Authorization"),
      "Bearer apiVersion%3A%20v1"
    );
  }
});

test("a DELETED subscription record prices as Pay-As-You-Go", async () => {
  // The plan loader normalizes DELETED records to the PAYG shape; Pricing
  // must reach the same verdict or the two tabs disagree about one workspace.
  const responses: Record<string, unknown> = {
    "/api/billing/plans": { plans: [] },
    "/api/billing/properties": { data: { properties: [] } },
    "/api/billing/regions": {
      current: { domain: "us.example.test", uid: "region-us" },
    },
    "/api/billing/subscription": {
      subscription: { Status: "DELETED", type: "SUBSCRIPTION" },
    },
  };

  const snapshot = await loadBillingPricing(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input) => {
        const url = new URL(input.toString(), "https://brain.example.test");
        return Promise.resolve(Response.json(responses[url.pathname]));
      },
    }
  );

  assert.equal(snapshot.isPayg, true);
});
