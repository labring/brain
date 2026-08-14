"use client";

import { sealosApp } from "@labring/sealos-desktop-sdk/app";
import { sealosLogoSrc } from "@workspace/ui/assets/brand";
import { deviconSrc, devicons } from "@workspace/ui/assets/devicons";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { DatabaseEngineIcon } from "@workspace/ui/components/database-engine-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Separator } from "@workspace/ui/components/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { House, PanelsTopLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type ComponentProps,
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { projectIdFromPathname } from "@/features/panes/use-project-id";
import { useProjectsExplorerReadModel } from "@/features/projects/explorer/use-projects-explorer";
import type {
  ProjectShortcutIconKey,
  ProjectShortcutIconKeyMap,
} from "@/features/projects/project-shortcut-icons";
import { useLastViewedProject } from "@/features/projects/use-last-viewed-project";
import {
  createProjectSidebarShortcutItems,
  type ProjectSidebarShortcutItem,
} from "@/features/shell/app-sidebar.shortcuts";
import {
  type AppSidebarUpgradeUsageRow,
  formatWorkspaceQuotaRows,
  type WorkspaceQuotaItem,
} from "@/features/shell/app-sidebar-upgrade";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

function ProjectShortcutIcon({
  active,
  iconKey,
}: {
  active?: boolean;
  iconKey: ProjectShortcutIconKey;
}) {
  if (iconKey !== "docker") {
    return (
      <DatabaseEngineIcon
        className={cn(
          "block size-4 shrink-0 object-contain transition-[filter]",
          iconKey !== "database" && !active && "brightness-0 invert"
        )}
        engine={iconKey === "database" ? undefined : iconKey}
        variant={active || iconKey === "mysql" ? "original" : "plain"}
      />
    );
  }

  const icon = devicons[iconKey];
  const src = deviconSrc(active ? icon.original : icon.plain);

  return (
    <span
      aria-hidden
      className={cn(
        "block size-4 bg-center bg-contain bg-no-repeat transition-[filter]",
        !active && "brightness-0 invert"
      )}
      style={{
        backgroundImage: `url(${JSON.stringify(src)})`,
      }}
    />
  );
}

function ProjectsShortcutIcon({
  showIconOnHover,
}: {
  showIconOnHover: boolean;
}) {
  return (
    <span aria-hidden className="relative block size-4">
      <span
        className={cn(
          "absolute inset-0 block bg-center bg-contain bg-no-repeat transition-opacity",
          showIconOnHover &&
            "group-hover/button:opacity-0 group-focus-visible/button:opacity-0"
        )}
        style={{ backgroundImage: `url(${JSON.stringify(sealosLogoSrc)})` }}
      />
      {showIconOnHover ? (
        <PanelsTopLeft
          aria-hidden
          className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/button:opacity-100 group-focus-visible/button:opacity-100"
          strokeWidth={1.33}
        />
      ) : null}
    </span>
  );
}

const APP_SIDEBAR_LINK_CLASS =
  "shrink-0 border-0 text-neutral-50 active:translate-y-0! aria-[current=page]:text-blue-400!";
const DESKTOP_DOMAIN_TRAILING_SLASHES_RE = /\/+$/;
const DESKTOP_DOMAIN_SCHEME_RE = /^https?:\/\//i;
const EMPTY_PROJECT_IDS: readonly string[] = Object.freeze([]);

const EMPTY_UPGRADE_USAGE_ROWS = formatWorkspaceQuotaRows([]);

function isWorkspaceQuotaItem(value: unknown): value is WorkspaceQuotaItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as { limit?: unknown; type?: unknown; used?: unknown };
  return (
    (item.type === "cpu" ||
      item.type === "memory" ||
      item.type === "storage" ||
      item.type === "nodeport") &&
    typeof item.used === "number" &&
    typeof item.limit === "number"
  );
}

async function loadWorkspaceQuotaRows(): Promise<AppSidebarUpgradeUsageRow[]> {
  const snapshot = await sealosApp.getWorkspaceQuota();
  return formatWorkspaceQuotaRows(
    Array.isArray(snapshot.quota)
      ? snapshot.quota.filter(isWorkspaceQuotaItem)
      : []
  );
}

async function openCostCenterApp() {
  await sealosApp.runEvents("openDesktopApp", {
    appKey: "system-costcenter",
    pathname: "/",
    query: {
      mode: "upgrade",
    },
    messageData: {
      type: "InternalAppCall",
      mode: "upgrade",
    },
  });
}

type AppSidebarLinkButtonProps = Pick<
  ComponentProps<typeof AppIconButton>,
  "aria-label" | "children" | "className"
> &
  Pick<ComponentProps<typeof Link>, "href"> & {
    active?: boolean;
    tooltip: ReactNode;
  };

function AppSidebarLinkButton({
  active,
  "aria-label": ariaLabel,
  children,
  className,
  href,
  tooltip,
}: AppSidebarLinkButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AppIconButton
            aria-current={active ? "page" : undefined}
            aria-label={ariaLabel}
            className={cn(APP_SIDEBAR_LINK_CLASS, className)}
            nativeButton={false}
            render={<Link href={href} />}
            size="lg"
            variant="quiet"
          >
            {children}
          </AppIconButton>
        }
      />
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function AppSidebarDesktopReturn() {
  const [desktopUrl, setDesktopUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadDesktopUrl = async () => {
      if (!sealosApp) {
        return;
      }

      try {
        const hostConfig = await sealosApp.getHostConfig();
        const domain = hostConfig.cloud.domain
          .trim()
          .replace(DESKTOP_DOMAIN_TRAILING_SLASHES_RE, "");
        if (cancelled || domain === "") {
          return;
        }

        const origin = DESKTOP_DOMAIN_SCHEME_RE.test(domain)
          ? domain
          : `https://${domain}`;
        setDesktopUrl(`${origin}/?openapp=`);
      } catch (error: unknown) {
        if (!cancelled) {
          console.warn(
            "[AppSidebarDesktopReturn] load Desktop host config failed:",
            error
          );
        }
      }
    };

    loadDesktopUrl().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AppIconButton
            aria-label="Back to Sealos Desktop"
            className={APP_SIDEBAR_LINK_CLASS}
            disabled={desktopUrl === null}
            nativeButton={desktopUrl === null}
            render={
              desktopUrl ? (
                <Link
                  href={desktopUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                />
              ) : undefined
            }
            size="lg"
            variant="quiet"
          >
            <House aria-hidden className="size-4" strokeWidth={1.8} />
          </AppIconButton>
        }
      />
      <TooltipContent side="right">Back to Sealos Desktop</TooltipContent>
    </Tooltip>
  );
}

function AppSidebarUpgrade() {
  const [open, setOpen] = useState(false);
  const [usageRows, setUsageRows] = useState<AppSidebarUpgradeUsageRow[]>(
    EMPTY_UPGRADE_USAGE_ROWS
  );
  const handleUpgradeClick = () => {
    openCostCenterApp().catch((error: unknown) => {
      console.warn("[AppSidebarUpgrade] open cost center failed:", error);
    });
  };
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      return;
    }
    loadWorkspaceQuotaRows()
      .then(setUsageRows)
      .catch((error: unknown) => {
        console.warn("[AppSidebarUpgrade] load workspace quota failed:", error);
        setUsageRows(EMPTY_UPGRADE_USAGE_ROWS);
      });
  }, []);

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger
        render={
          <AppIconButton
            aria-label="Upgrade"
            className={APP_SIDEBAR_LINK_CLASS}
            size="lg"
            type="button"
            variant="quiet"
          >
            <Sparkles aria-hidden className="size-4" strokeWidth={1.8} />
          </AppIconButton>
        }
      />
      <PopoverContent
        align="start"
        alignOffset={0}
        className="w-[219px] gap-0 rounded-lg border border-border bg-input/30 p-4 text-brand-primary-foreground shadow-none ring-0 backdrop-blur-xl"
        side="right"
        sideOffset={6}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {usageRows.map(([label, value]) => (
              <div
                className="flex w-full items-start justify-between gap-4 whitespace-nowrap text-sm/5"
                key={label}
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="text-brand-primary-foreground tabular-nums">
                  {value}
                </span>
              </div>
            ))}
          </div>

          <AppButton
            className="w-full"
            onClick={handleUpgradeClick}
            type="button"
            variant="secondary"
          >
            <Sparkles
              aria-hidden
              className="size-4"
              data-icon="inline-start"
              strokeWidth={1.75}
            />
            <span>Upgrade</span>
          </AppButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface AppSidebarProjectShortcutsProps {
  currentProjectId: string | undefined;
  projectShortcutIconKeys: ProjectShortcutIconKeyMap | undefined;
  projectShortcutItems: readonly ProjectSidebarShortcutItem[];
}

const AppSidebarProjectShortcuts = memo(function AppSidebarProjectShortcuts({
  currentProjectId,
  projectShortcutIconKeys,
  projectShortcutItems,
}: AppSidebarProjectShortcutsProps) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
      data-slot="app-sidebar-project-shortcuts"
    >
      {projectShortcutItems.length === 0 && (
        <Separator
          aria-hidden
          className="my-1.5 w-9 rounded-full bg-border"
          data-slot="app-sidebar-project-separator"
        />
      )}
      {projectShortcutItems.map((item, index) => {
        const { project } = item;
        const iconKey = projectShortcutIconKeys?.get(project.id) ?? "docker";
        const active = currentProjectId === project.id;
        const ariaLabel =
          item.kind === "lastViewed"
            ? `Last viewed unpinned project: ${project.name}`
            : `Pinned project: ${project.name}`;
        const showSeparatorBeforeItem =
          index === 0 && item.kind !== "lastViewed";
        const showSeparatorAfterItem = item.kind === "lastViewed";

        return (
          <Fragment key={`${item.kind}:${project.id}`}>
            {showSeparatorBeforeItem && (
              <Separator
                aria-hidden
                className="my-1.5 w-9 rounded-full bg-border"
                data-slot="app-sidebar-project-separator"
              />
            )}
            <AppSidebarLinkButton
              active={active}
              aria-label={ariaLabel}
              href={`/project/${encodeURIComponent(project.id)}`}
              tooltip={project.name}
            >
              <ProjectShortcutIcon active={active} iconKey={iconKey} />
            </AppSidebarLinkButton>
            {showSeparatorAfterItem && (
              <Separator
                aria-hidden
                className="my-1.5 w-9 rounded-full bg-border"
                data-slot="app-sidebar-project-separator"
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
});

interface AppSidebarChromeProps {
  currentProjectId: string | undefined;
  projectsActive: boolean;
}

const AppSidebarChrome = memo(function AppSidebarChrome({
  currentProjectId,
  projectsActive,
}: AppSidebarChromeProps) {
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom);
  const { lastViewedProjectId, setLastViewedProject } =
    useLastViewedProject(namespace);
  const handledProjectRouteId = useRef<string | undefined>(undefined);

  const { states } = useProjectsExplorerReadModel({
    kubeconfig,
    ns: namespace,
  });

  const pinnedProjectIds = states.pinnedProjectIds ?? EMPTY_PROJECT_IDS;
  const projectShortcutIconKeys = states.projectShortcutIconKeys;
  const projectShortcutItems = useMemo(
    () =>
      createProjectSidebarShortcutItems({
        lastViewedProjectId,
        pinnedProjectIds,
        projects: states.projects,
      }),
    [lastViewedProjectId, pinnedProjectIds, states.projects]
  );

  useEffect(() => {
    if (currentProjectId === undefined) {
      handledProjectRouteId.current = undefined;
      return;
    }
    if (handledProjectRouteId.current === currentProjectId) {
      return;
    }
    if (!states.projects.some((project) => project.id === currentProjectId)) {
      return;
    }

    handledProjectRouteId.current = currentProjectId;
    if (!pinnedProjectIds.includes(currentProjectId)) {
      setLastViewedProject(currentProjectId);
    }
  }, [
    currentProjectId,
    pinnedProjectIds,
    setLastViewedProject,
    states.projects,
  ]);

  useEffect(() => {
    if (
      lastViewedProjectId !== undefined &&
      pinnedProjectIds.includes(lastViewedProjectId)
    ) {
      setLastViewedProject(undefined);
    }
  }, [lastViewedProjectId, pinnedProjectIds, setLastViewedProject]);

  return (
    <aside
      className="project-chrome-surface flex h-full w-13 shrink-0 flex-col items-center border-border border-r"
      data-slot="app-sidebar"
    >
      <div className="flex min-h-0 flex-1 flex-col items-start gap-3 px-2 py-2.5">
        <nav
          aria-label="Project shortcuts"
          className="flex min-h-0 w-9 flex-1 flex-col gap-1.5"
        >
          <AppSidebarLinkButton
            active={projectsActive}
            aria-label="Projects"
            className="aria-[current=page]:bg-transparent!"
            href="/project"
            tooltip="Projects"
          >
            <ProjectsShortcutIcon
              showIconOnHover={currentProjectId !== undefined}
            />
          </AppSidebarLinkButton>

          <AppSidebarProjectShortcuts
            currentProjectId={currentProjectId}
            projectShortcutIconKeys={projectShortcutIconKeys}
            projectShortcutItems={projectShortcutItems}
          />
        </nav>

        <div
          className="flex w-9 shrink-0 flex-col gap-3"
          data-slot="app-sidebar-bottom-actions"
        >
          <Separator
            aria-hidden
            className="w-9 rounded-full bg-border"
            data-slot="app-sidebar-bottom-separator"
          />
          <AppSidebarDesktopReturn />
          <AppSidebarUpgrade />
        </div>
      </div>
    </aside>
  );
});

export default function AppSidebar() {
  const pathname = usePathname();

  return (
    <AppSidebarChrome
      currentProjectId={projectIdFromPathname(pathname)}
      projectsActive={pathname === "/project"}
    />
  );
}
