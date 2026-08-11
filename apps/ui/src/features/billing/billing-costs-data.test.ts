import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCompactBillingAmount } from "./billing-amount";
import {
  buildDailyCostTrend,
  buildMonthlyBillingTrend,
  buildWorkspaceCostBreakdown,
  calendarBillingDateRange,
  fixedTrendWindows,
  loadBillingAppCosts,
  loadBillingCosts,
  resolveBillingAppType,
  subscriptionPaymentDescription,
} from "./billing-costs-data";

const DATE_RANGE = {
  endTime: "2026-03-31T23:59:59.999Z",
  startTime: "2026-01-01T00:00:00.000Z",
};

test("calendar dates remain in the selected UTC billing month", () => {
  assert.deepEqual(
    calendarBillingDateRange({ end: "2026-07-30", start: "2026-07-01" }),
    {
      endTime: "2026-07-30T23:59:59.999Z",
      startTime: "2026-07-01T00:00:00.000Z",
    }
  );
  assert.equal(
    calendarBillingDateRange({ end: "2026-02-30", start: "2026-02-01" }),
    null
  );
});

test("daily cost trend zero-fills the range and leads with the merged Total", () => {
  const trend = buildDailyCostTrend({
    dateRange: {
      endTime: "2026-07-03T23:59:59.999Z",
      startTime: "2026-07-01T00:00:00.000Z",
    },
    regions: [
      {
        costPoints: [
          [Date.UTC(2026, 6, 1, 8) / 1000, "1000000"],
          [Date.UTC(2026, 6, 3, 8) / 1000, 500_000],
        ],
        label: "US West",
      },
      {
        costPoints: [[Date.UTC(2026, 6, 3, 9) / 1000, "250000"]],
        label: "Hangzhou",
      },
    ],
  });

  assert.deepEqual(trend.series, [
    { dataKey: "total", label: "Total" },
    { dataKey: "region0", label: "US West" },
    { dataKey: "region1", label: "Hangzhou" },
  ]);
  assert.deepEqual(
    trend.points.map(({ label }) => label),
    ["Jul 1", "Jul 2", "Jul 3"]
  );
  assert.deepEqual(trend.points[1], {
    label: "Jul 2",
    region0: 0,
    region1: 0,
    total: 0,
  });
  assert.deepEqual(trend.points[2], {
    label: "Jul 3",
    region0: 500_000,
    region1: 250_000,
    total: 750_000,
  });
});

test("fixed trend windows always end now and span 7 days and 6 months", () => {
  const windows = fixedTrendWindows(new Date("2026-08-07T10:30:00.000Z"));

  assert.deepEqual(windows, {
    daily: {
      endTime: "2026-08-07T10:30:00.000Z",
      startTime: "2026-08-01T00:00:00.000Z",
    },
    monthly: {
      endTime: "2026-08-07T10:30:00.000Z",
      startTime: "2026-03-01T00:00:00.000Z",
    },
  });
  assert.equal(
    buildDailyCostTrend({ dateRange: windows.daily, regions: [] }).points
      .length,
    7
  );
  assert.equal(
    buildMonthlyBillingTrend({
      costPoints: [],
      dateRange: windows.monthly,
      payments: [],
    }).length,
    6
  );
});

test("chart axes identify the cluster Billing Currency", () => {
  assert.equal(formatCompactBillingAmount(1_500_000_000_000, "usd"), "$1.5M");
  assert.equal(
    formatCompactBillingAmount(1_500_000_000_000, "shellCoin"),
    "1.5M ShellCoin"
  );
});

test("payment descriptions never expose recharge terminology", () => {
  assert.equal(
    subscriptionPaymentDescription({
      Amount: 1_000_000,
      ID: "payment-a",
      Operator: "",
      PlanName: "",
      Time: "2026-07-01T00:00:00.000Z",
      Type: "account_recharge",
      Workspace: "workspace-a",
    }),
    "account payment"
  );
});

test("the selected date range drives every Costs data request", async () => {
  const requests: Array<{ pathname: string; body: Record<string, unknown> }> =
    [];
  const responseByPathname: Record<string, unknown> = {
    "/api/billing/app-overview": {
      data: { overviews: [], total: 0, totalPage: 1 },
    },
    "/api/billing/app-types": { data: { "1": "DEVBOX" } },
    "/api/billing/consumption": { amount: 5_000_000 },
    "/api/billing/costs": {
      data: { costs: [[1_769_990_400, "1000000"]] },
      message: "ok",
    },
    "/api/billing/payments": { payments: [] },
    "/api/billing/regions": {
      regions: [
        {
          domain: "us.example.test",
          name: { en: "United States", zh: "US" },
          uid: "region-us",
        },
      ],
    },
    "/api/billing/workspace-consumption": {
      amount: { "workspace-a": 4_000_000 },
    },
    "/api/billing/workspaces": {
      data: [["workspace-a", "Research"]],
    },
  };

  const snapshot = await loadBillingCosts(
    {
      appToken: "desktop-app-token",
      dateRange: DATE_RANGE,
      kubeconfig: "apiVersion: v1",
      page: 2,
      pageSize: 10,
      workspace: null,
    },
    (input, init) => {
      const pathname = new URL(input.toString(), "https://brain.test").pathname;
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requests.push({ body, pathname });

      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer apiVersion%3A%20v1");
      assert.equal(headers.get("X-Sealos-App-Token"), "desktop-app-token");
      return Promise.resolve(Response.json(responseByPathname[pathname]));
    }
  );

  assert.deepEqual(
    requests.map(({ pathname }) => pathname).sort(),
    Object.keys(responseByPathname).sort()
  );
  for (const { body, pathname } of requests) {
    if (
      pathname === "/api/billing/app-types" ||
      pathname === "/api/billing/regions"
    ) {
      assert.deepEqual(body, {});
      continue;
    }
    assert.equal(body.startTime, DATE_RANGE.startTime, pathname);
    assert.equal(body.endTime, DATE_RANGE.endTime, pathname);
  }
  assert.deepEqual(
    requests.find(({ pathname }) => pathname === "/api/billing/app-overview")
      ?.body,
    {
      appName: "",
      appType: "",
      endTime: DATE_RANGE.endTime,
      namespace: "",
      page: 2,
      pageSize: 10,
      startTime: DATE_RANGE.startTime,
    }
  );
  assert.deepEqual(snapshot.region, {
    domain: "us.example.test",
    name: { en: "United States", zh: "US" },
    uid: "region-us",
  });
});

test("monthly trends combine expenditure with paid Subscription Payments", () => {
  const payment = {
    Amount: 2_000_000,
    ID: "payment-a",
    Operator: "renewed",
    PlanName: "Pro",
    Time: "2026-01-20T10:00:00.000Z",
    Type: "SUBSCRIPTION",
    Workspace: "workspace-a",
  };

  assert.deepEqual(
    buildMonthlyBillingTrend({
      costPoints: [
        [Date.parse("2026-01-05T00:00:00.000Z") / 1000, "1500000"],
        [Date.parse("2026-01-25T00:00:00.000Z") / 1000, "2500000"],
        [Date.parse("2026-02-10T00:00:00.000Z") / 1000, "3000000"],
      ],
      dateRange: DATE_RANGE,
      payments: [
        payment,
        {
          ...payment,
          Amount: 4_000_000,
          ID: "payment-b",
          Status: "PAID",
          Time: "2026-02-14T10:00:00.000Z",
          Type: "ACCOUNT_RECHARGE",
        },
        {
          ...payment,
          Amount: 9_000_000,
          ID: "payment-c",
          Status: "PENDING",
          Time: "2026-02-15T10:00:00.000Z",
        },
      ],
    }),
    [
      {
        expenditureMicroUnits: 4_000_000,
        label: "Jan 2026",
        month: "2026-01",
        paymentMicroUnits: 2_000_000,
      },
      {
        expenditureMicroUnits: 3_000_000,
        label: "Feb 2026",
        month: "2026-02",
        paymentMicroUnits: 4_000_000,
      },
      {
        expenditureMicroUnits: 0,
        label: "Mar 2026",
        month: "2026-03",
        paymentMicroUnits: 0,
      },
    ]
  );
});

test("workspace totals keep subscription and Consumption Cost distinct", () => {
  const payment = {
    Amount: 6_000_000,
    ID: "payment-a",
    Operator: "renewed",
    PlanName: "Pro",
    Time: "2026-01-20T10:00:00.000Z",
    Type: "SUBSCRIPTION",
    Workspace: "workspace-a",
  };

  assert.deepEqual(
    buildWorkspaceCostBreakdown({
      payments: [
        payment,
        {
          ...payment,
          Amount: 10_000_000,
          ID: "payment-b",
          Type: "ACCOUNT_RECHARGE",
        },
        {
          ...payment,
          Amount: 20_000_000,
          ID: "payment-c",
          Status: "PENDING",
          Workspace: "workspace-b",
        },
      ],
      workspaceConsumptionMicroUnits: {
        "workspace-a": 4_000_000,
        "workspace-b": 1_000_000,
      },
      workspaces: [
        ["workspace-a", "Research"],
        ["workspace-b", "Staging"],
      ],
    }),
    [
      {
        consumptionMicroUnits: 4_000_000,
        id: "workspace-a",
        name: "Research",
        subscriptionMicroUnits: 6_000_000,
        totalMicroUnits: 10_000_000,
      },
      {
        consumptionMicroUnits: 1_000_000,
        id: "workspace-b",
        name: "Staging",
        subscriptionMicroUnits: 0,
        totalMicroUnits: 1_000_000,
      },
    ]
  );
});

test("the per-app drawer uses the tab's active date range", async () => {
  let requestBody: Record<string, unknown> | undefined;

  const page = await loadBillingAppCosts(
    {
      appName: "postgres-main",
      appToken: "desktop-app-token",
      appType: "5",
      dateRange: DATE_RANGE,
      kubeconfig: "apiVersion: v1",
      namespace: "workspace-a",
      page: 3,
      pageSize: 10,
    },
    (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        Response.json({
          app_costs: {
            costs: [],
            current_page: 3,
            total_pages: 4,
            total_records: 34,
          },
        })
      );
    }
  );

  assert.deepEqual(requestBody, {
    appName: "postgres-main",
    appType: "5",
    endTime: DATE_RANGE.endTime,
    namespace: "workspace-a",
    orderID: "",
    page: 3,
    pageSize: 10,
    startTime: DATE_RANGE.startTime,
  });
  assert.deepEqual(page, {
    costs: [],
    currentPage: 3,
    totalPages: 4,
    totalRecords: 34,
  });
});

test("app type codes resolve to display names but query with the code", () => {
  assert.deepEqual(resolveBillingAppType(1, { "1": "DB" }), {
    queryAppType: "DB",
    typeName: "Database",
  });
  assert.deepEqual(resolveBillingAppType(12, { "12": "NEW-THING" }), {
    queryAppType: "NEW-THING",
    typeName: "NEW-THING",
  });
  assert.deepEqual(resolveBillingAppType(9, {}), {
    queryAppType: "9",
    typeName: "App type 9",
  });
});
