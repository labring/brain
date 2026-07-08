import type {
  TemplateDeploymentChoice,
  TemplateDeploymentSettings,
} from "../template-deployer";

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
 * simulated install flows — the deployer does not dispatch it.
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
   * True when the current workspace user has a server-side GitHub connection.
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
  templateOptions?: readonly TemplateDeploymentChoice[];
  templateOptionsLoading?: boolean;
}

/**
 * Props passed into `GithubDeployer.Root`. Callbacks are invoked directly (no wrapper delays).
 * GitHub connect/configure behavior is entirely host-defined via `onAuthorize`.
 */
export interface GithubDeployerActions {
  /** Invoked when the user connects or reconfigures workspace GitHub access. */
  onAuthorize?: () => void;
  /** Invoked when Deploy is pressed with the selected repo. */
  onDeploy?: (repo: GithubDeployerRepo) => void | Promise<void>;
  /** Invoked when the user accepts a matched app-store template recommendation. */
  onDeployTemplate?: (input: {
    repo: GithubDeployerRepo;
    settings: TemplateDeploymentSettings;
    template: TemplateDeploymentChoice;
  }) => void | Promise<void>;
  /** Invoked when the user disconnects the current server-side GitHub credential. */
  onDisconnect?: () => void;
}

export interface GithubDeployerResolvedActions {
  onAuthorize?: () => void;
  onDeploy?: (repo: GithubDeployerRepo) => void | Promise<void>;
  onDeployTemplate?: GithubDeployerActions["onDeployTemplate"];
  onDisconnect?: () => void;
}

export interface GithubDeployerValue {
  actions: GithubDeployerResolvedActions;
  requestDeploy: (repo: GithubDeployerRepo) => void;
  requestDisconnect: () => void;
  selectedRepoId: string;
  setSelectedRepoId: (id: string) => void;
  states: GithubDeployerStates;
}
