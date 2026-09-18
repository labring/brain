import { kubeconfigCredentialKey } from "@workspace/api/credential-key";

/**
 * The invariant every client cache key obeys (ADR-0083, spec §A.9): a key
 * derives from the Brain Session's credential atoms — kubeconfig fingerprint,
 * namespace, app token, regional token — so re-establishing the session in
 * place (the silent 401 re-exchange today, an in-place Workspace switch when
 * Brain opens standalone) invalidates every cache without any consumer
 * knowing. Keys are built here so `swr-keys.test.ts` can walk them all and
 * prove that changing any one credential changes every key.
 *
 * The onboarding gate keys its judgment on its own credentials key
 * (`onboardingCredentialsKey`) and is deliberately left alone.
 */

export interface SessionCredentials {
  appToken: string;
  kubeconfig: string;
  namespace: string;
  regionalToken: string;
}

const FINGERPRINT_SEPARATOR = "|";

/** The session's credential fingerprint: what every key below embeds. */
export function sessionCredentialFingerprint(
  credentials: SessionCredentials
): string {
  return [
    credentials.namespace.trim(),
    kubeconfigCredentialKey(credentials.kubeconfig),
    credentials.appToken.trim(),
    credentials.regionalToken.trim(),
  ].join(FINGERPRINT_SEPARATOR);
}

function sessionKey<P extends string>(prefix: P) {
  return (credentials: SessionCredentials) =>
    [prefix, sessionCredentialFingerprint(credentials)] as const;
}

/**
 * Every SWR key constructor that reads the session. Prefixes are the
 * dev-mock revalidation contract (`billing/dev-mock-swr-keys.ts` matches on
 * them), so a rename here is a rename there.
 */
export const SESSION_SWR_KEYS = {
  appSidebarSubscription: sessionKey("app-sidebar-subscription"),
  /** The Switcher's plan badges; the `billing-` prefix is the billing mock's. */
  billingWorkspacePlans: sessionKey("billing-workspace-plans"),
  githubConnection: sessionKey("github-connection"),
  githubUserRepos: sessionKey("github-user-repos"),
  notificationsCredits: sessionKey("notifications-credits"),
  notificationsFeed: sessionKey("notifications-feed"),
  notificationsToppedUp: sessionKey("notifications-topped-up"),
  statusHintBalance: sessionKey("status-hint-balance"),
  statusHintPlans: sessionKey("status-hint-plans"),
  statusHintQuota: sessionKey("status-hint-quota"),
  /** The Workspace Area's Managed Workspace read, `POST /api/workspace/details`. */
  workspaceDetails: sessionKey("workspace-details"),
  /** The Switcher's list refresh through `GET /api/workspace/list`. */
  workspaceList: sessionKey("workspace-list"),
  workspaceOwner: sessionKey("workspace-owner"),
} as const;
