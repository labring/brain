"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Link2,
  Lock,
  Rocket,
  Search,
  ShieldCheck,
} from "lucide-react";
import { type ComponentProps, useMemo, useState } from "react";

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

function githubUrlToRepo(input: string): GithubDeployerRepo | null {
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

  const [owner, repoSegment] = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const repo = repoSegment?.replace(GIT_SUFFIX_RE, "");
  if (!(owner && repo)) {
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

function MethodSection({
  children,
  className,
  defaultOpen,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  defaultOpen: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={cn(
        "overflow-hidden rounded-md border border-border bg-card/60",
        !open && "border-transparent bg-muted/40",
        className
      )}
      data-slot={`github-deployer-${title.toLowerCase().replace(" ", "-")}`}
    >
      <button
        className="flex h-12 w-full items-center justify-between px-4 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="font-medium text-base text-foreground">{title}</span>
        {open ? (
          <ChevronUp aria-hidden className="size-4 text-foreground" />
        ) : (
          <ChevronDown aria-hidden className="size-4 text-foreground" />
        )}
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </section>
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
          "flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-muted/30 font-medium text-foreground text-sm",
          className
        )}
        data-slot="github-deployer-auth-loading"
        role="status"
      >
        <Spinner aria-hidden className="size-5 shrink-0" />
        <span>Authorizing...</span>
      </div>
    );
  }

  return (
    <AppButton
      aria-label="Authorize GitHub"
      className={cn(
        "h-10 w-full gap-2 rounded-md border-border bg-muted/30 text-sm hover:bg-muted/50",
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
    actions: { onDeploy },
    states: { deployedRepo, isLoading },
  } = useGithubDeployer();
  const [repoUrl, setRepoUrl] = useState("");
  const parsedRepo = useMemo(() => githubUrlToRepo(repoUrl), [repoUrl]);
  const showInvalid = repoUrl.trim() !== "" && !parsedRepo;

  if (deployedRepo) {
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
            className="h-10 rounded-md border-border bg-transparent pl-10 text-sm"
            disabled={isLoading}
            onChange={(event) => setRepoUrl(event.currentTarget.value)}
            placeholder="https://github.com/owner/repo"
            type="url"
            value={repoUrl}
          />
        </div>
        <AppButton
          className="h-10 min-w-24 rounded-md bg-muted text-foreground text-sm hover:bg-muted/80"
          data-slot="github-deployer-url-deploy"
          disabled={!(parsedRepo && onDeploy) || isLoading}
          onClick={() => {
            if (parsedRepo && onDeploy) {
              onDeploy(parsedRepo);
            }
          }}
          type="button"
          variant="secondary"
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

function repoLabel(repo: GithubDeployerRepo): string {
  return repo.fullName ?? repo.name;
}

function repoDescription(repo: GithubDeployerRepo): string {
  return repo.description?.trim() || "This is a placeholder.";
}

function GithubRepoCard({
  featured,
  onDeploy,
  repo,
}: {
  featured: boolean;
  onDeploy?: (repo: GithubDeployerRepo) => void;
  repo: GithubDeployerRepo;
}) {
  return (
    <article
      className={cn(
        "flex min-h-20 w-full min-w-0 items-center gap-3 rounded-md bg-muted/50 px-4 py-3",
        featured && "border border-border bg-muted/40"
      )}
      data-slot="github-deployer-repo-card"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="truncate font-medium text-base text-foreground">
            {repoLabel(repo)}
          </h3>
          {repo.isPrivate ? (
            <Lock aria-label="Private repository" className="size-4 shrink-0" />
          ) : null}
        </div>
        <p className="mt-2 truncate text-muted-foreground text-sm">
          {repoDescription(repo)}
        </p>
      </div>
      <AppButton
        className={cn(
          "h-10 min-w-28 gap-2 rounded-md bg-muted text-foreground text-sm shadow-sm hover:bg-muted/80",
          featured && "text-primary"
        )}
        data-slot="github-deployer-repo-deploy"
        disabled={!onDeploy}
        onClick={() => onDeploy?.(repo)}
        type="button"
        variant="secondary"
      >
        <Rocket aria-hidden className="size-4" strokeWidth={2} />
        Deploy
      </AppButton>
    </article>
  );
}

function GithubDeployerRepoSelect({ className }: { className?: string }) {
  const {
    actions: { onDeploy },
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
      <p
        className="font-medium text-emerald-400 text-sm"
        data-slot="github-deployer-authorized"
        role="status"
      >
        GitHub Connected
      </p>
      <div className="relative min-w-0">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={2}
        />
        <AppInput
          className="h-10 rounded-md border-border bg-transparent pl-10 text-sm"
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
          className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
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
            <Rocket aria-hidden className="size-4" strokeWidth={2} />
          </Button>
        </div>
      ) : null}
      {isLoading ? (
        <div
          aria-busy="true"
          aria-live="polite"
          className="flex h-16 w-full min-w-0 items-center gap-3 rounded-md bg-muted/40 px-4 text-muted-foreground text-sm"
          data-slot="github-deployer-repos-loading"
          role="status"
        >
          <Spinner aria-hidden className="size-5 shrink-0" />
          <span>Loading repositories...</span>
        </div>
      ) : null}
      {!(errorMessage || isLoading) && filteredRepos.length === 0 ? (
        <p
          className="w-full min-w-0 rounded-md bg-muted/40 px-4 py-3 text-muted-foreground text-sm"
          data-slot="github-deployer-repo-empty"
        >
          No repositories found for this GitHub account.
        </p>
      ) : null}
      {!(errorMessage || isLoading) && visibleRepos.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-3">
          {visibleRepos.map((repo, index) => (
            <GithubRepoCard
              featured={index === 0}
              key={repo.id}
              onDeploy={onDeploy}
              repo={repo}
            />
          ))}
        </div>
      ) : null}
      {canViewMore ? (
        <button
          className="mx-auto mt-1 h-7 px-3 text-foreground text-sm hover:text-primary"
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
        "flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-muted/40 p-3",
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
  return (
    <div
      className={cn("flex w-full min-w-0 flex-col gap-5", className)}
      data-slot="github-deployer-shell"
      {...props}
    >
      <header className="flex min-w-0 flex-col gap-2">
        <GithubDeployerTitle />
        <GithubDeployerSubtitle />
      </header>
      <MethodSection defaultOpen title="Method 1">
        <GithubDeployerUrlInput />
      </MethodSection>
      <MethodSection defaultOpen title="Method 2">
        <GithubDeployerAuthButton />
        <GithubDeployerRepoSelect />
      </MethodSection>
      <GithubDeployerComplete />
    </div>
  );
}

/** Compound GitHub OAuth + deploy repo picker; state comes from `Root`. */
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
