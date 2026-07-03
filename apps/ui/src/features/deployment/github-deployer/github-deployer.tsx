"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import {
  CheckCircle2,
  Link2,
  Link2Off,
  Lock,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
} from "lucide-react";
import { type ComponentProps, type ReactNode, useMemo, useState } from "react";
import { DeploymentSettings } from "../deployment-settings";
import {
  GithubDeployerContext,
  GithubDeployerRoot,
  useGithubDeployer,
} from "./github-deployer.context";
import type { GithubDeployerRepo } from "./github-deployer.types";

/** GitHub invertocat path (matches common monochrome mark). */
const GITHUB_MARK_PATH =
  "M12 2c5.5228 0 10 4.47715 10 10 0 4.5716 -3.0686 8.4239 -7.2578 9.6162v-3.0117c0 -0.7275 -0.1595 -1.4465 -0.4678 -2.1055 2.1883 -0.7822 4.2783 -2.4447 4.2783 -4.4355 0 -1.2663 -0.4671 -2.75174 -1.5127 -3.63186V6l-2.9462 0.98828c-0.6589 -0.16036 -1.3628 -0.24706 -2.0938 -0.24707 -0.731 0 -1.4349 0.08673 -2.09375 0.24707L6.95996 6v2.43164c-1.04555 0.88009 -1.51163 2.36566 -1.51172 3.63186 0 1.9907 2.08913 3.6533 4.27735 4.4355 -0.26358 0.5635 -0.41862 1.1711 -0.45801 1.7901 -0.13854 0.0283 -0.25191 0.0415 -0.34473 0.04 -0.20756 -0.0033 -0.36606 -0.06 -0.51953 -0.1562 -1.11532 -0.7 -1.54401 -1.9835 -3.05566 -2.1543 -0.19076 -0.0214 -0.3474 0.1371 -0.34766 0.3291 0 0.1922 0.15921 0.3423 0.34473 0.3925 1.44216 0.39 1.42755 3.2266 3.54785 3.2598 0.11976 0.0019 0.24101 -0.0069 0.36426 -0.0186v1.6348C5.06807 20.4236 2 16.5713 2 12 2 6.47715 6.47715 2 12 2";

const URL_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const GIT_SUFFIX_RE = /\.git$/i;
const INITIAL_REPO_LIMIT = 4;
const REPO_LIMIT_STEP = 4;

export function githubUrlToRepo(input: string): GithubDeployerRepo | null {
  const raw = input.trim();
  if (raw === "") {
    return null;
  }

  const withProtocol = URL_PROTOCOL_RE.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase() !== "github.com") {
    return null;
  }

  const [owner, repoSegment, extraPath] = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const repo = repoSegment?.replace(GIT_SUFFIX_RE, "");
  if (!(owner && repo) || extraPath != null) {
    return null;
  }

  const fullName = `${owner}/${repo}`;
  return {
    fullName,
    id: `github-url:${fullName}`,
    name: repo,
    url: `https://github.com/${fullName}`,
  };
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("shrink-0", className)}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>GitHub</title>
      <path d={GITHUB_MARK_PATH} fill="currentColor" />
    </svg>
  );
}

function GithubDeployerTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-3", className)}
      data-slot="github-deployer-title"
      {...props}
    >
      <GithubIcon className="size-4 text-primary" />
      <span className="font-semibold text-foreground text-lg">
        GitHub Import
      </span>
    </div>
  );
}

function GithubDeployerSubtitle({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("w-full min-w-0 text-muted-foreground text-sm", className)}
      data-slot="github-deployer-subtitle"
      {...props}
    >
      Import repository from URL or GitHub authorization.
    </p>
  );
}

function GithubDeployerAuthButton({ className }: { className?: string }) {
  const {
    actions: { onAuthorize },
    states: { isAuthorized, deployedRepo, isLoading },
  } = useGithubDeployer();

  if (deployedRepo || isAuthorized) {
    return null;
  }

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className={cn(
          "flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white/5 font-medium text-primary text-sm",
          className
        )}
        data-slot="github-deployer-auth-loading"
        role="status"
      >
        <Spinner aria-hidden className="size-4 shrink-0" />
        <span>Authorizing...</span>
      </div>
    );
  }

  return (
    <AppButton
      aria-label="Authorize GitHub"
      className={cn(
        "h-9 w-full rounded-lg bg-white/5 text-primary hover:bg-input",
        className
      )}
      data-slot="github-deployer-auth-connect"
      disabled={!onAuthorize}
      onClick={onAuthorize}
      type="button"
      variant="quiet"
    >
      <ShieldCheck aria-hidden className="size-4 shrink-0" strokeWidth={2} />
      <span>Authorize GitHub</span>
    </AppButton>
  );
}

function GithubDeployerUrlInput({ className }: { className?: string }) {
  const {
    actions: { onDeploy, onDeployTemplate },
    requestDeploy,
    states: { deployedRepo, isAuthorized, isLoading, templateOptionsLoading },
  } = useGithubDeployer();
  const [repoUrl, setRepoUrl] = useState("");
  const parsedRepo = useMemo(() => githubUrlToRepo(repoUrl), [repoUrl]);
  const showInvalid = repoUrl.trim() !== "" && !parsedRepo;
  const isTemplateMatchingPending = Boolean(
    onDeployTemplate && templateOptionsLoading
  );
  const canDeploy = Boolean(
    isAuthorized && parsedRepo && onDeploy && !isTemplateMatchingPending
  );

  if (deployedRepo || !isAuthorized) {
    return null;
  }

  return (
    <div
      className={cn("flex w-full min-w-0 flex-col gap-3", className)}
      data-slot="github-deployer-url-input"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Link2
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
          />
          <AppInput
            aria-invalid={showInvalid || undefined}
            className="pl-10"
            disabled={isLoading}
            onChange={(event) => setRepoUrl(event.currentTarget.value)}
            placeholder="https://github.com/owner/repo"
            type="url"
            value={repoUrl}
          />
        </div>
        <AppButton
          className="min-w-24 rounded-lg"
          data-slot="github-deployer-url-deploy"
          disabled={!canDeploy || isLoading}
          onClick={() => {
            if (canDeploy && parsedRepo) {
              requestDeploy(parsedRepo);
            }
          }}
          type="button"
          variant="primary"
        >
          <Rocket aria-hidden className="size-4" strokeWidth={2} />
          Deploy
        </AppButton>
      </div>
      {showInvalid ? (
        <p
          className="text-destructive text-xs"
          data-slot="github-deployer-url-error"
        >
          Enter a GitHub repository URL.
        </p>
      ) : null}
    </div>
  );
}

function GithubDeployerLockedSection({
  description,
  icon,
  title,
}: {
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <DeploymentSettings.Section
      description={description}
      icon={icon}
      title={title}
    />
  );
}

function repoLabel(repo: GithubDeployerRepo): string {
  return repo.fullName ?? repo.name;
}

function repoDescription(repo: GithubDeployerRepo): string {
  return repo.description?.trim() || "No description provided.";
}

function GithubRepoCard({
  featured,
  repo,
}: {
  featured: boolean;
  repo: GithubDeployerRepo;
}) {
  const {
    actions: { onDeploy, onDeployTemplate },
    requestDeploy,
    states: { templateOptionsLoading },
  } = useGithubDeployer();
  const isTemplateMatchingPending = Boolean(
    onDeployTemplate && templateOptionsLoading
  );
  const canDeploy = Boolean(
    (onDeploy || onDeployTemplate) && !isTemplateMatchingPending
  );

  return (
    <article
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-input/30 px-3 py-2.5",
        featured && "border-primary/35 bg-primary/5"
      )}
      data-slot="github-deployer-repo-card"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate font-medium text-foreground text-sm leading-5">
            {repoLabel(repo)}
          </h3>
          {repo.isPrivate ? (
            <Lock
              aria-label="Private repository"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
        </div>
        <p className="mt-1 truncate text-muted-foreground text-xs leading-4">
          {repoDescription(repo)}
        </p>
      </div>
      <AppButton
        className="h-8 min-w-24 rounded-lg"
        data-slot="github-deployer-repo-deploy"
        disabled={!canDeploy}
        onClick={() => {
          if (canDeploy) {
            requestDeploy(repo);
          }
        }}
        type="button"
        variant="primary"
      >
        <Rocket aria-hidden className="size-4" strokeWidth={2} />
        Deploy
      </AppButton>
    </article>
  );
}

function GithubDeployerRepoSelect({ className }: { className?: string }) {
  const {
    states: {
      isAuthorized,
      deployedRepo,
      isLoading,
      repoError,
      repoRetry,
      repos,
    },
  } = useGithubDeployer();
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(INITIAL_REPO_LIMIT);

  const filteredRepos = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") {
      return [...repos];
    }
    return repos.filter((repo) => {
      const haystack = [repo.fullName, repo.name, repo.description ?? ""]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query, repos]);

  const visibleRepos = filteredRepos.slice(0, visibleCount);
  const canViewMore = visibleCount < filteredRepos.length;

  if (deployedRepo || !isAuthorized) {
    return null;
  }

  const errorMessage =
    repoError instanceof Error ? repoError.message : repoError;

  return (
    <div
      className={cn("flex w-full min-w-0 flex-col gap-3", className)}
      data-slot="github-deployer-repo-select"
    >
      <div className="relative min-w-0">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={2}
        />
        <AppInput
          className="pl-10"
          disabled={isLoading}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setVisibleCount(INITIAL_REPO_LIMIT);
          }}
          placeholder="Search"
          type="search"
          value={query}
        />
      </div>
      {errorMessage ? (
        <div
          className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5"
          data-slot="github-deployer-repo-error"
        >
          <p className="min-w-0 flex-1 text-destructive text-sm">
            Could not load GitHub repositories: {errorMessage}
          </p>
          <Button
            aria-label="Retry repositories"
            className="size-8 shrink-0"
            disabled={!repoRetry}
            onClick={repoRetry}
            size="icon"
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden className="size-4" strokeWidth={2} />
          </Button>
        </div>
      ) : null}
      {isLoading ? (
        <div
          aria-busy="true"
          aria-live="polite"
          className="flex h-12 w-full min-w-0 items-center gap-3 rounded-md bg-input/30 px-3 text-muted-foreground text-sm"
          data-slot="github-deployer-repos-loading"
          role="status"
        >
          <Spinner aria-hidden className="size-4 shrink-0" />
          <span>Loading repositories...</span>
        </div>
      ) : null}
      {!(errorMessage || isLoading) && filteredRepos.length === 0 ? (
        <p
          className="w-full min-w-0 rounded-md bg-input/30 px-3 py-2.5 text-muted-foreground text-sm"
          data-slot="github-deployer-repo-empty"
        >
          No repositories found for this GitHub account.
        </p>
      ) : null}
      {!(errorMessage || isLoading) && visibleRepos.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2">
          {visibleRepos.map((repo, index) => (
            <GithubRepoCard featured={index === 0} key={repo.id} repo={repo} />
          ))}
        </div>
      ) : null}
      {canViewMore ? (
        <button
          className="mx-auto mt-1 h-7 rounded-md px-3 text-muted-foreground text-sm hover:bg-input/30 hover:text-foreground"
          data-slot="github-deployer-view-more"
          onClick={() =>
            setVisibleCount((count) =>
              Math.min(count + REPO_LIMIT_STEP, filteredRepos.length)
            )
          }
          type="button"
        >
          View More
        </button>
      ) : null}
    </div>
  );
}

function GithubDeployerAccountStatus() {
  const {
    actions: { onDisconnect },
    requestDisconnect,
    states: { deployedRepo, isAuthorized, isLoading },
  } = useGithubDeployer();

  if (deployedRepo || !isAuthorized) {
    return null;
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <div
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md bg-input/30 px-3 text-muted-foreground text-sm"
        data-slot="github-deployer-authorized"
        role="status"
      >
        <CheckCircle2
          aria-hidden
          className="size-4 shrink-0 text-primary"
          strokeWidth={2}
        />
        <span className="truncate">GitHub Connected</span>
      </div>
      <Button
        aria-label="Disconnect GitHub"
        className="size-9 rounded-lg bg-white/5 text-muted-foreground hover:bg-input hover:text-foreground"
        data-slot="github-deployer-disconnect"
        disabled={isLoading || !onDisconnect}
        onClick={requestDisconnect}
        size="icon-lg"
        type="button"
        variant="ghost"
      >
        <Link2Off aria-hidden className="size-4" strokeWidth={2} />
      </Button>
    </div>
  );
}

function GithubDeployerComplete({ className }: ComponentProps<"div">) {
  const {
    states: { deployedRepo },
  } = useGithubDeployer();

  if (!deployedRepo) {
    return null;
  }

  const label = deployedRepo.fullName ?? deployedRepo.name;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-input/30 p-3",
        className
      )}
      data-slot="github-deployer-complete"
      role="status"
    >
      <CheckCircle2
        aria-hidden
        className="size-5 shrink-0 text-foreground"
        strokeWidth={2}
      />
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-medium text-foreground text-sm">Deployed</span>
        <span className="truncate text-muted-foreground text-sm">{label}</span>
      </div>
    </div>
  );
}

function GithubDeployerShell({ className, ...props }: ComponentProps<"div">) {
  const {
    states: { deployedRepo, isAuthorized },
  } = useGithubDeployer();
  const showGithubAccount = !deployedRepo;
  const showRepositoryInput = isAuthorized && !deployedRepo;
  const showLockedRepositorySections = !(isAuthorized || deployedRepo);

  return (
    <div
      className={cn("dark flex w-full min-w-0 flex-col gap-3.5", className)}
      data-slot="github-deployer-shell"
      {...props}
    >
      {showGithubAccount ? (
        <DeploymentSettings.Section
          description="This is a description placeholder."
          icon={<ShieldCheck aria-hidden className="size-4" />}
          title="GitHub Account"
        >
          <DeploymentSettings.Control>
            <GithubDeployerAuthButton />
            <GithubDeployerAccountStatus />
          </DeploymentSettings.Control>
        </DeploymentSettings.Section>
      ) : null}
      {showRepositoryInput ? (
        <DeploymentSettings.Section
          description="Deploy from a repository URL."
          icon={<Link2 aria-hidden className="size-4" />}
          title="Repository URL"
        >
          <DeploymentSettings.Control>
            <GithubDeployerUrlInput />
          </DeploymentSettings.Control>
        </DeploymentSettings.Section>
      ) : null}
      {showLockedRepositorySections ? (
        <GithubDeployerLockedSection
          description="Please authorize your GitHub account to deploy from a GitHub repository URL."
          icon={<Link2 aria-hidden className="size-4" />}
          title="Repository URL"
        />
      ) : null}
      {showLockedRepositorySections ? (
        <GithubDeployerLockedSection
          description="Install the GitHub App for this workspace before selecting a repository."
          icon={<GithubIcon className="size-4" />}
          title="Repository"
        />
      ) : null}
      {showRepositoryInput ? (
        <DeploymentSettings.Section
          description="Select a repository from this workspace's GitHub App installation."
          icon={<GithubIcon className="size-4" />}
          title="Repository"
        >
          <DeploymentSettings.Control>
            <GithubDeployerRepoSelect />
          </DeploymentSettings.Control>
        </DeploymentSettings.Section>
      ) : null}
      <GithubDeployerComplete />
    </div>
  );
}

/** Compound GitHub App install + deploy repo picker; state comes from `Root`. */
const GithubDeployerBase = Object.assign(GithubDeployerShell, {
  AuthButton: GithubDeployerAuthButton,
  Complete: GithubDeployerComplete,
  Context: GithubDeployerContext,
  RepoSelect: GithubDeployerRepoSelect,
  Root: GithubDeployerRoot,
  Shell: GithubDeployerShell,
  Subtitle: GithubDeployerSubtitle,
  Title: GithubDeployerTitle,
  UrlInput: GithubDeployerUrlInput,
  useGithubDeployer,
});

GithubDeployerAuthButton.displayName = "GithubDeployer.AuthButton";
GithubDeployerComplete.displayName = "GithubDeployer.Complete";
GithubDeployerRepoSelect.displayName = "GithubDeployer.RepoSelect";
GithubDeployerShell.displayName = "GithubDeployer.Shell";
GithubDeployerSubtitle.displayName = "GithubDeployer.Subtitle";
GithubDeployerTitle.displayName = "GithubDeployer.Title";
GithubDeployerUrlInput.displayName = "GithubDeployer.UrlInput";

export const GithubDeployer = GithubDeployerBase;

export type {
  GithubDeployerActions,
  GithubDeployerRepo,
  GithubDeployerResolvedActions,
  GithubDeployerStates,
  GithubDeployerValue,
} from "./github-deployer.types";
