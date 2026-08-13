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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import {
  CreditCard,
  House,
  PanelLeft,
  PanelsTopLeft,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type ComponentProps,
  type CSSProperties,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";
import { projectIdFromPathname } from "@/features/panes/use-project-id";
import { useProjectsExplorerReadModel } from "@/features/projects/explorer/use-projects-explorer";
import type {
  ProjectShortcutIconKey,
  ProjectShortcutIconKeyMap,
} from "@/features/projects/project-shortcut-icons";
import { createAppSidebarProjectGroups } from "@/features/shell/app-sidebar.groups";
import {
  type AppSidebarUpgradeUsageRow,
  formatWorkspaceQuotaRows,
  type WorkspaceQuotaItem,
} from "@/features/shell/app-sidebar-upgrade";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
import { useSealosDesktopUrl } from "@/lib/sealos-desktop-url";

const APP_SIDEBAR_NAV_ID = "app-sidebar-nav";
const APP_SIDEBAR_WIDTH = "16.5rem";
const APP_SIDEBAR_WIDTH_ICON = "3.25rem";
const APP_SIDEBAR_LABEL_STAGGER_CAP = 9;
const APP_SIDEBAR_LABEL_STAGGER_MS = 25;
const EMPTY_PROJECT_IDS: readonly string[] = Object.freeze([]);
const EMPTY_UPGRADE_USAGE_ROWS = formatWorkspaceQuotaRows([]);

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

function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block shrink-0 bg-center bg-contain bg-no-repeat",
        className
      )}
      style={{
        backgroundImage: `url(${JSON.stringify(sealosLogoSrc)})`,
      }}
    />
  );
}

function labelDelay(index: number, expanded: boolean): string {
  if (!expanded) {
    return "0ms";
  }
  return `${Math.min(index, APP_SIDEBAR_LABEL_STAGGER_CAP) * APP_SIDEBAR_LABEL_STAGGER_MS}ms`;
}

interface AppSidebarNavRowProps {
  active?: boolean;
  ariaLabel?: string;
  href?: string;
  icon: ReactNode;
  index: number;
  label: string;
  onClick?: ComponentProps<typeof Link>["onClick"];
  rel?: string;
  target?: string;
}

function AppSidebarNavRow({
  active,
  ariaLabel,
  href,
  icon,
  index,
  label,
  onClick,
  rel,
  target,
}: AppSidebarNavRowProps) {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const accessibleName = ariaLabel ?? label;
  const className = cn(
    "group/row relative flex h-8 w-full shrink-0 items-center overflow-hidden rounded-md text-left text-neutral-50 text-sm",
    active && "text-blue-400"
  );
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "app-sidebar-hover absolute inset-y-0 left-0 rounded-md transition-[width,background-color] duration-200 group-hover/row:bg-input/30",
          expanded ? "w-full" : "w-9",
          active && expanded && "bg-input group-hover/row:bg-input"
        )}
      />
      <span className="relative flex w-9 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span
        className={cn(
          "app-sidebar-label relative min-w-0 flex-1 truncate whitespace-nowrap pr-2 transition-[opacity,transform] motion-reduce:transition-none",
          expanded
            ? "translate-x-0 opacity-100 duration-300"
            : "-translate-x-2 opacity-0 duration-150"
        )}
        style={{
          transitionDelay: labelDelay(index, expanded),
        }}
      >
        {label}
      </span>
    </>
  );
  const sharedProps = {
    "aria-current": active ? ("page" as const) : undefined,
    "aria-label": accessibleName,
    className,
    title: expanded ? label : undefined,
  };

  const row = href ? (
    <Link
      href={href}
      onClick={onClick}
      rel={rel}
      target={target}
      {...sharedProps}
    >
      {body}
    </Link>
  ) : (
    <span {...sharedProps}>{body}</span>
  );

  if (expanded) {
    return row;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function AppSidebarGroupHeading({ children }: { children: ReactNode }) {
  const { state } = useSidebar();
  const expanded = state === "expanded";

  return (
    <div
      className={cn(
        "app-sidebar-heading relative shrink-0 overflow-hidden transition-[height] duration-150 motion-reduce:transition-none",
        expanded ? "h-8" : "h-4"
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 bottom-1 truncate pl-2 font-medium text-muted-foreground text-xs uppercase tracking-wider transition-opacity duration-150 motion-reduce:transition-none",
          expanded ? "opacity-100" : "opacity-0"
        )}
      >
        {children}
      </div>
      <div
        aria-hidden
        className={cn(
          "absolute top-1/2 left-0 h-px w-9 rounded-full bg-border transition-opacity duration-150 motion-reduce:transition-none",
          expanded ? "opacity-0" : "opacity-100"
        )}
      />
    </div>
  );
}

function AppSidebarHeader() {
  const { setOpen, state } = useSidebar();

  if (state === "expanded") {
    return (
      <div className="flex h-11 shrink-0 items-center">
        <span className="flex w-9 shrink-0 items-center justify-center">
          <BrandLogo className="size-5" />
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-neutral-50 text-sm">
          Sealos
        </span>
        <AppIconButton
          aria-controls={APP_SIDEBAR_NAV_ID}
          aria-expanded
          aria-label="Collapse sidebar"
          className="shrink-0 border-0 text-neutral-50"
          data-slot="app-sidebar-collapse"
          onClick={() => {
            setOpen(false);
          }}
          size="lg"
          type="button"
          variant="quiet"
        >
          <PanelLeft aria-hidden className="size-4" strokeWidth={1.33} />
        </AppIconButton>
      </div>
    );
  }

  return (
    <div className="flex h-11 shrink-0 items-center">
      <AppIconButton
        aria-controls={APP_SIDEBAR_NAV_ID}
        aria-expanded={false}
        aria-label="Expand sidebar"
        className="group/expand shrink-0 border-0 text-neutral-50"
        data-slot="app-sidebar-expand"
        onClick={() => {
          setOpen(true);
        }}
        size="lg"
        type="button"
        variant="quiet"
      >
        <span aria-hidden className="relative block size-4">
          <span
            className="absolute inset-0 bg-center bg-contain bg-no-repeat opacity-100 transition-opacity duration-150 group-hover/expand:opacity-0 group-focus-visible/expand:opacity-0 motion-reduce:transition-none"
            style={{ backgroundImage: `url(${JSON.stringify(sealosLogoSrc)})` }}
          />
          <PanelLeft
            className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/expand:opacity-100 group-focus-visible/expand:opacity-100 motion-reduce:transition-none"
            strokeWidth={1.33}
          />
        </span>
      </AppIconButton>
    </div>
  );
}

function AppSidebarDesktopReturn({ index }: { index: number }) {
  const desktopUrl = useSealosDesktopUrl();

  return (
    <AppSidebarNavRow
      ariaLabel="Back to Desktop"
      href={desktopUrl ?? undefined}
      icon={<House aria-hidden className="size-4" strokeWidth={1.8} />}
      index={index}
      label="Back to Desktop"
      rel={desktopUrl ? "noopener noreferrer" : undefined}
      target={desktopUrl ? "_blank" : undefined}
    />
  );
}

function isWorkspaceQuotaItem(value: unknown): value is WorkspaceQuotaItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as { limit?: unknown; type?: unknown; used?: unknown };
  return (
    (item.type === "cpu" ||
      item.type === "memory" ||
      item.type === "storage" ||
      item.type === "pod" ||
      item.type === "nodeport") &&
    typeof item.used === "number" &&
    typeof item.limit === "number"
  );
}

async function loadWorkspaceQuotaRows(): Promise<AppSidebarUpgradeUsageRow[]> {
  const snapshot = await sealosApp.getWorkspaceQuota();
  const rawQuota: readonly unknown[] = Array.isArray(snapshot.quota)
    ? snapshot.quota
    : [];
  return formatWorkspaceQuotaRows(rawQuota.filter(isWorkspaceQuotaItem));
}

function AppSidebarUpgrade() {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const [open, setOpen] = useState(false);
  const [usageRows, setUsageRows] = useState<AppSidebarUpgradeUsageRow[]>(
    EMPTY_UPGRADE_USAGE_ROWS
  );
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

  const trigger = expanded ? (
    <AppButton className="w-full" type="button" variant="secondary">
      <Sparkles
        aria-hidden
        className="size-4"
        data-icon="inline-start"
        strokeWidth={1.75}
      />
      <span>Upgrade</span>
    </AppButton>
  ) : (
    <AppIconButton
      aria-label="Upgrade"
      className="shrink-0 border-0 text-neutral-50"
      size="lg"
      type="button"
      variant="quiet"
    >
      <Sparkles aria-hidden className="size-4" strokeWidth={1.8} />
    </AppIconButton>
  );

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger render={trigger} />
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
            nativeButton={false}
            render={
              <Link
                href="/billing?mode=upgrade"
                onClick={recordBillingReturnRoute}
              />
            }
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

function AppSidebarProjectRow({
  ariaLabel,
  currentProjectId,
  iconKey,
  index,
  project,
}: {
  ariaLabel?: string;
  currentProjectId: string | undefined;
  iconKey: ProjectShortcutIconKey;
  index: number;
  project: { id: string; name: string };
}) {
  const active = currentProjectId === project.id;
  return (
    <AppSidebarNavRow
      active={active}
      ariaLabel={ariaLabel}
      href={`/project/${encodeURIComponent(project.id)}`}
      icon={<ProjectShortcutIcon active={active} iconKey={iconKey} />}
      index={index}
      label={project.name}
    />
  );
}

const AppSidebarProjectGroupsNav = memo(function AppSidebarProjectGroupsNav({
  currentProjectId,
  groups,
  projectShortcutIconKeys,
}: {
  currentProjectId: string | undefined;
  groups: ReturnType<typeof createAppSidebarProjectGroups>;
  projectShortcutIconKeys: ProjectShortcutIconKeyMap | undefined;
}) {
  let rowIndex = 1;

  return (
    <>
      {groups.pinned.length > 0 ? (
        <div className="shrink-0" data-slot="app-sidebar-pinned">
          <AppSidebarGroupHeading>PINNED</AppSidebarGroupHeading>
          <div className="flex flex-col gap-1.5">
            {groups.pinned.map((project) => {
              const index = rowIndex;
              rowIndex += 1;
              return (
                <AppSidebarProjectRow
                  ariaLabel={`Pinned project: ${project.name}`}
                  currentProjectId={currentProjectId}
                  iconKey={projectShortcutIconKeys?.get(project.id) ?? "docker"}
                  index={index}
                  key={project.id}
                  project={project}
                />
              );
            })}
          </div>
        </div>
      ) : null}
      {groups.projects.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <AppSidebarGroupHeading>PROJECTS</AppSidebarGroupHeading>
          <div className="min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%-10px),transparent)]">
            <div className="flex flex-col gap-1.5 py-1">
              {groups.projects.map((project) => {
                const index = rowIndex;
                rowIndex += 1;
                return (
                  <AppSidebarProjectRow
                    currentProjectId={currentProjectId}
                    iconKey={
                      projectShortcutIconKeys?.get(project.id) ?? "docker"
                    }
                    index={index}
                    key={project.id}
                    project={project}
                  />
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
});

function AppSidebarFocusTransfer() {
  const { state } = useSidebar();
  const previousState = useRef(state);

  useEffect(() => {
    if (previousState.current === state) {
      return;
    }
    previousState.current = state;
    const selector =
      state === "expanded"
        ? '[data-slot="app-sidebar-collapse"]'
        : '[data-slot="app-sidebar-expand"]';
    document.querySelector<HTMLElement>(selector)?.focus();
  }, [state]);

  return null;
}

function AppSidebarChrome({
  billingActive,
  currentProjectId,
  projectsActive,
}: {
  billingActive: boolean;
  currentProjectId: string | undefined;
  projectsActive: boolean;
}) {
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom);
  const { states } = useProjectsExplorerReadModel({
    kubeconfig,
    ns: namespace,
  });
  const groups = useMemo(
    () =>
      createAppSidebarProjectGroups({
        pinnedProjectIds: states.pinnedProjectIds ?? EMPTY_PROJECT_IDS,
        projects: states.projects,
      }),
    [states.pinnedProjectIds, states.projects]
  );

  return (
    <Sidebar
      className="app-sidebar-surface [&_[data-slot=sidebar-inner]]:project-chrome-surface border-border [&_[data-slot=sidebar-inner]]:overflow-hidden"
      collapsible="icon"
    >
      <div className="flex h-full min-h-0 w-(--sidebar-width) flex-col px-2 py-2.5">
        <SidebarHeader className="p-0">
          <AppSidebarHeader />
        </SidebarHeader>
        <SidebarContent className="min-h-0 overflow-hidden p-0 group-data-[collapsible=icon]:overflow-hidden">
          <nav
            aria-label="Projects"
            className="flex min-h-0 flex-1 flex-col"
            id={APP_SIDEBAR_NAV_ID}
          >
            <div className="pt-2">
              <AppSidebarNavRow
                active={projectsActive}
                href="/project"
                icon={
                  <PanelsTopLeft
                    aria-hidden
                    className="size-4"
                    strokeWidth={1.33}
                  />
                }
                index={0}
                label="Projects"
              />
            </div>
            <AppSidebarProjectGroupsNav
              currentProjectId={currentProjectId}
              groups={groups}
              projectShortcutIconKeys={states.projectShortcutIconKeys}
            />
          </nav>
        </SidebarContent>
        <SidebarFooter className="p-0">
          <div className="flex shrink-0 flex-col gap-2 pt-3">
            <AppSidebarNavRow
              active={billingActive}
              href="/billing"
              icon={
                <CreditCard aria-hidden className="size-4" strokeWidth={1.8} />
              }
              index={(states.projects?.length ?? 0) + 1}
              label="Billing"
              onClick={recordBillingReturnRoute}
            />
            <AppSidebarDesktopReturn
              index={(states.projects?.length ?? 0) + 2}
            />
            <AppSidebarUpgrade />
          </div>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}

export function AppSidebarShell({
  children,
  defaultOpen = true,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <SidebarProvider
      className="min-h-0 min-w-0 flex-1"
      defaultOpen={defaultOpen}
      enableMobile={false}
      style={
        {
          "--sidebar-width": APP_SIDEBAR_WIDTH,
          "--sidebar-width-icon": APP_SIDEBAR_WIDTH_ICON,
        } as CSSProperties
      }
    >
      <AppSidebarFocusTransfer />
      {children}
    </SidebarProvider>
  );
}

export default function AppSidebar() {
  const pathname = usePathname();

  return (
    <AppSidebarChrome
      billingActive={pathname.startsWith("/billing")}
      currentProjectId={projectIdFromPathname(pathname)}
      projectsActive={pathname === "/project"}
    />
  );
}
