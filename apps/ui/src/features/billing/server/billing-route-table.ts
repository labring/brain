/**
 * Single source of truth for the /api/billing/* route surface: each route's
 * public path and the account-service pathname it proxies to. Route handlers
 * take their upstream pathname from here, the dev-mock contract tests resolve
 * routes through it, and the guard test in billing-route-table.test.ts
 * cross-checks entries against the route files on disk — so the mapping can
 * never drift silently.
 */

export interface BillingRouteEntry {
  /** Public route path served by this app, e.g. "/api/billing/account". */
  apiPath: string;
  /**
   * account-service pathname the route proxies to — or, for the few routes
   * Brain answers itself (ADR-0074's survey write), the `brain:` dispatch key
   * the dev-mock fixtures answer under. Either way it is the key both the
   * dev-mock dispatcher and the contract tests resolve the route by.
   */
  upstreamPathname: string;
}

export const BILLING_ROUTES = {
  account: {
    apiPath: "/api/billing/account",
    upstreamPathname: "/account/v1alpha1/account",
  },
  appCosts: {
    apiPath: "/api/billing/app-costs",
    upstreamPathname: "/account/v1alpha1/costs/workspace/app",
  },
  appOverview: {
    apiPath: "/api/billing/app-overview",
    upstreamPathname: "/account/v1alpha1/cost-overview",
  },
  appTypes: {
    apiPath: "/api/billing/app-types",
    upstreamPathname: "/account/v1alpha1/cost-app-type-list",
  },
  card: {
    apiPath: "/api/billing/card",
    upstreamPathname: "/account/v1alpha1/workspace-subscription/card-info",
  },
  cardManage: {
    apiPath: "/api/billing/card/manage",
    upstreamPathname: "/account/v1alpha1/workspace-subscription/card-manage",
  },
  consumption: {
    apiPath: "/api/billing/consumption",
    upstreamPathname: "/account/v1alpha1/costs/consumption",
  },
  costs: {
    apiPath: "/api/billing/costs",
    upstreamPathname: "/account/v1alpha1/costs",
  },
  // The one billing upstream outside the /account/v1alpha1 group: credits
  // live in account-service's payment route group (AIM-315).
  credits: {
    apiPath: "/api/billing/credits",
    upstreamPathname: "/payment/v1alpha1/credits/info",
  },
  payments: {
    apiPath: "/api/billing/payments",
    upstreamPathname: "/account/v1alpha1/workspace-subscription/payment-list",
  },
  plans: {
    apiPath: "/api/billing/plans",
    upstreamPathname: "/account/v1alpha1/workspace-subscription/plan-list",
  },
  properties: {
    apiPath: "/api/billing/properties",
    upstreamPathname: "/account/v1alpha1/properties",
  },
  regions: {
    apiPath: "/api/billing/regions",
    upstreamPathname: "/account/v1alpha1/regions",
  },
  subscription: {
    apiPath: "/api/billing/subscription",
    upstreamPathname: "/account/v1alpha1/workspace-subscription/info",
  },
  // Brain's own write (ADR-0074): no account-service upstream, so the key is
  // a Brain dispatch key rather than a pathname.
  subscriptionCancellationSurvey: {
    apiPath: "/api/billing/subscription/cancellation-survey",
    upstreamPathname: "brain:subscription/cancellation-survey",
  },
  subscriptionInvoiceCancel: {
    apiPath: "/api/billing/subscription/invoice-cancel",
    upstreamPathname: "/account/v1alpha1/workspace-subscription/invoice-cancel",
  },
  subscriptionLastTransaction: {
    apiPath: "/api/billing/subscription/last-transaction",
    upstreamPathname:
      "/account/v1alpha1/workspace-subscription/last-transaction",
  },
  subscriptionPay: {
    apiPath: "/api/billing/subscription/pay",
    upstreamPathname: "/account/v1alpha1/workspace-subscription/pay",
  },
  subscriptionUpgradeAmount: {
    apiPath: "/api/billing/subscription/upgrade-amount",
    upstreamPathname: "/account/v1alpha1/workspace-subscription/upgrade-amount",
  },
  subscriptions: {
    apiPath: "/api/billing/subscriptions",
    upstreamPathname: "/account/v1alpha1/workspace-subscription/list",
  },
  workspaceConsumption: {
    apiPath: "/api/billing/workspace-consumption",
    upstreamPathname: "/account/v1alpha1/costs/workspace/consumption",
  },
  workspaceQuota: {
    apiPath: "/api/billing/workspace-quota",
    upstreamPathname: "/account/v1alpha1/workspace/get-resource-quota",
  },
  workspaces: {
    apiPath: "/api/billing/workspaces",
    upstreamPathname: "/account/v1alpha1/namespaces",
  },
} as const satisfies Record<string, BillingRouteEntry>;
