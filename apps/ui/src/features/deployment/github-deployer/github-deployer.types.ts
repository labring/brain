export interface GithubDeployerRepo {
  description?: string | null;
  fullName?: string;
  id: string;
  isPrivate?: boolean;
  name: string;
  url?: string;
}

/**
 * Optional: hosts may dispatch this from `actions.onAuthorize` to coordinate in-page
 * “simulate OAuth” flows — the deployer does not dispatch it.
 */
export const GITHUB_DEPLOYER_AUTHORIZE_SIMULATE_EVENT =
  "agui:github-deployer:authorize" as const;

/** Reserved for hosts that listen for deploy without wiring `onDeploy` (optional pattern). */
export const GITHUB_DEPLOYER_DEPLOY_EVENT =
  "agui:github-deployer:deploy" as const;

/** Serializable deployer state from the app (`isAuthorized` + `repos` + optional `deployedRepo`). */
export interface GithubDeployerStates {
  /**
   * When set, **complete** stage: deployment finished (host-driven).
   * Takes precedence over auth / repo picker.
   */
  deployedRepo?: GithubDeployerRepo | null;
  /**
   * True when the host has a server-side GitHub credential for the current scope.
   */
  isAuthorized?: boolean;
  /**
   * Optional: show “Authorizing…” before a token exists, and “Loading repositories…” once
   * authorized while the host resolves `repos`.
   */
  isLoading?: boolean;
  /** Repository list load error after authorization. */
  repoError?: Error | string | null;
  /** Retry repository list loading after an error. */
  repoRetry?: () => void;
  repos: readonly GithubDeployerRepo[];
}

/**
 * Props passed into `GithubDeployer.Root`. Callbacks are invoked directly (no wrapper delays).
 * Auth behavior is entirely host-defined via `onAuthorize`.
 */
export interface GithubDeployerActions {
  /** Invoked when the user clicks “Authorize GitHub”. Omit or leave unset to show a disabled control. */
  onAuthorize?: () => void;
  /** Invoked when Deploy is pressed with the selected repo. */
  onDeploy?: (repo: GithubDeployerRepo) => void;
}

export interface GithubDeployerResolvedActions {
  onAuthorize?: () => void;
  onDeploy?: (repo: GithubDeployerRepo) => void;
}

export interface GithubDeployerValue {
  actions: GithubDeployerResolvedActions;
  selectedRepoId: string;
  setSelectedRepoId: (id: string) => void;
  states: GithubDeployerStates;
}
