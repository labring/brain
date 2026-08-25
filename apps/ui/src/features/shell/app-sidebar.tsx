"use client";

import { sealosLogoSrc } from "@workspace/ui/assets/brand";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { BrandMark } from "@workspace/ui/components/brand-mark";
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
  ArrowUpRight,
  ChevronRight,
  CreditCard,
  Database,
  House,
  PanelLeft,
  PanelsTopLeft,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type ComponentProps,
  type CSSProperties,
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";
import { projectIdFromPathname } from "@/features/panes/use-project-id";
import { useProjectsExplorerReadModel } from "@/features/projects/explorer/use-projects-explorer";
import type {
  ProjectIconKey,
  ProjectIconKeyMap,
} from "@/features/projects/project-icons";
import { createAppSidebarProjectGroups } from "@/features/shell/app-sidebar.groups";
import { AppSidebarAccount } from "@/features/shell/app-sidebar-account";
import { AppSidebarNotifications } from "@/features/shell/app-sidebar-notifications";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
import { useSealosDesktopUrl } from "@/lib/sealos-desktop-url";

const APP_SIDEBAR_NAV_ID = "app-sidebar-nav";
const APP_SIDEBAR_WIDTH = "13.75rem";
const APP_SIDEBAR_WIDTH_ICON = "3.25rem";
const EMPTY_PROJECT_IDS: readonly string[] = Object.freeze([]);

function ProjectIcon({
  active,
  iconKey,
}: {
  active?: boolean;
  iconKey: ProjectIconKey;
}) {
  if (iconKey === "database") {
    return (
      <Database
        aria-hidden
        className={cn(
          "size-4 shrink-0 transition-colors",
          !active && "text-neutral-400"
        )}
        strokeWidth={1.8}
      />
    );
  }

  return (
    <BrandMark
      brandKey={iconKey}
      className={cn("transition-colors", !active && "text-neutral-400")}
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

interface AppSidebarNavRowProps {
  active?: boolean;
  ariaLabel?: string;
  href?: string;
  icon: ReactNode;
  label: string;
  onClick?: ComponentProps<typeof Link>["onClick"];
  rel?: string;
  target?: string;
  trailing?: ReactNode;
}

function AppSidebarNavRow({
  active,
  ariaLabel,
  href,
  icon,
  label,
  onClick,
  rel,
  target,
  trailing,
}: AppSidebarNavRowProps) {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const iconSlotRef = useRef<HTMLSpanElement>(null);
  const accessibleName = ariaLabel ?? label;
  const className =
    "group/row relative flex h-8 w-full shrink-0 items-center overflow-hidden rounded-md text-left text-neutral-50 text-sm";
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "app-sidebar-hover absolute inset-y-0 left-0 rounded-md transition-[width,background-color] group-hover/row:bg-input/30 motion-reduce:transition-none",
          expanded
            ? "w-full duration-300 ease-sidebar"
            : "w-9 duration-200 ease-out",
          active && "bg-input group-hover/row:bg-input"
        )}
      />
      <span
        className={cn(
          "relative flex w-9 shrink-0 items-center justify-center",
          active && "text-blue-400"
        )}
        ref={iconSlotRef}
      >
        {icon}
      </span>
      <span
        className={cn(
          "app-sidebar-label relative min-w-0 flex-1 truncate whitespace-nowrap pr-2 transition-opacity motion-reduce:transition-none",
          expanded
            ? "opacity-100 duration-300 ease-sidebar"
            : "opacity-0 duration-200 ease-out"
        )}
      >
        {label}
      </span>
      {trailing ? (
        <span
          aria-hidden
          className={cn(
            "relative flex shrink-0 items-center pr-2.5 text-muted-foreground opacity-0 transition-opacity duration-150 motion-reduce:transition-none",
            expanded &&
              "group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
          )}
        >
          {trailing}
        </span>
      ) : null}
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

  // Tooltip root/trigger stay mounted in both states so the row keeps one DOM
  // tree across expand/collapse. `disabled` (not conditional content) turns it
  // off while expanded — hovers must never reach the open state, or every
  // stuck-open tooltip pops at once when collapsing mounts the popups.
  // Anchor to the icon slot, not the row: the row keeps its full expanded
  // width under the collapsed rail's clipping, which would float the tooltip
  // far from the visible edge.
  return (
    <Tooltip disabled={expanded}>
      <TooltipTrigger render={row} />
      <TooltipContent anchor={iconSlotRef} side="right">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function AppSidebarGroupHeading({
  children,
  collapsed,
  onToggle,
}: {
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const { state } = useSidebar();
  const expanded = state === "expanded";

  return (
    <div
      className={cn(
        "app-sidebar-heading relative shrink-0 overflow-hidden transition-[height] motion-reduce:transition-none",
        expanded
          ? "h-10 duration-300 ease-sidebar"
          : "h-4 duration-200 ease-out"
      )}
    >
      <button
        aria-expanded={!collapsed}
        className={cn(
          "group/heading absolute inset-0 flex w-full cursor-pointer items-end pb-1 text-left transition-opacity duration-150 motion-reduce:transition-none",
          expanded ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onToggle}
        tabIndex={expanded ? undefined : -1}
        type="button"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1 pl-2 font-medium text-muted-foreground text-xs transition-colors group-hover/heading:text-neutral-300">
          <span className="truncate">{children}</span>
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3 shrink-0 transition-[opacity,transform] duration-150 motion-reduce:transition-none",
              !collapsed && "rotate-90",
              collapsed
                ? "opacity-100"
                : "opacity-0 group-hover/heading:opacity-100 group-focus-visible/heading:opacity-100"
            )}
            strokeWidth={1.8}
          />
        </span>
      </button>
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
  const expanded = state === "expanded";

  // One DOM tree for both states: the logo never leaves the icon slot. While
  // expanded the logo button is inert (the PanelLeft button on the right
  // collapses); once collapsed it becomes the expand control, swapping to a
  // PanelLeft glyph on hover.
  return (
    <div className="flex h-11 shrink-0 items-center">
      <AppIconButton
        aria-controls={APP_SIDEBAR_NAV_ID}
        aria-expanded={expanded ? undefined : false}
        aria-hidden={expanded || undefined}
        aria-label="Expand sidebar"
        className={cn(
          "group/expand shrink-0 border-0 text-neutral-50",
          expanded && "pointer-events-none"
        )}
        data-slot="app-sidebar-expand"
        onClick={() => {
          setOpen(true);
        }}
        size="lg"
        tabIndex={expanded ? -1 : undefined}
        type="button"
        variant="quiet"
      >
        <span aria-hidden className="relative block size-5">
          <BrandLogo className="absolute inset-0 size-5 opacity-100 transition-opacity duration-150 group-hover/expand:opacity-0 group-focus-visible/expand:opacity-0 motion-reduce:transition-none" />
          <PanelLeft
            className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/expand:opacity-100 group-focus-visible/expand:opacity-100 motion-reduce:transition-none"
            strokeWidth={1.33}
          />
        </span>
      </AppIconButton>
      <span
        className={cn(
          "min-w-0 flex-1 truncate whitespace-nowrap font-semibold text-neutral-50 text-sm transition-opacity motion-reduce:transition-none",
          expanded
            ? "opacity-100 duration-300 ease-sidebar"
            : "opacity-0 duration-200 ease-out"
        )}
      >
        Sealos
      </span>
      <AppIconButton
        aria-controls={APP_SIDEBAR_NAV_ID}
        aria-expanded
        aria-hidden={expanded ? undefined : true}
        aria-label="Collapse sidebar"
        className={cn(
          "shrink-0 border-0 text-neutral-50 transition-opacity motion-reduce:transition-none",
          expanded
            ? "opacity-100 duration-300 ease-sidebar"
            : "pointer-events-none opacity-0 duration-150 ease-out"
        )}
        data-slot="app-sidebar-collapse"
        onClick={() => {
          setOpen(false);
        }}
        size="lg"
        tabIndex={expanded ? undefined : -1}
        type="button"
        variant="quiet"
      >
        <PanelLeft aria-hidden className="size-4" strokeWidth={1.33} />
      </AppIconButton>
    </div>
  );
}

function AppSidebarDesktopReturn() {
  const desktopUrl = useSealosDesktopUrl();

  return (
    <AppSidebarNavRow
      ariaLabel="Sealos Desktop"
      href={desktopUrl ?? undefined}
      icon={<House aria-hidden className="size-4" strokeWidth={1.8} />}
      label="Sealos Desktop"
      rel={desktopUrl ? "noopener noreferrer" : undefined}
      target={desktopUrl ? "_blank" : undefined}
      trailing={
        <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={1.8} />
      }
    />
  );
}

function AppSidebarProjectRow({
  ariaLabel,
  currentProjectId,
  iconKey,
  project,
}: {
  ariaLabel?: string;
  currentProjectId: string | undefined;
  iconKey: ProjectIconKey;
  project: { id: string; name: string };
}) {
  const active = currentProjectId === project.id;
  return (
    <AppSidebarNavRow
      active={active}
      ariaLabel={ariaLabel}
      href={`/project/${encodeURIComponent(project.id)}`}
      icon={<ProjectIcon active={active} iconKey={iconKey} />}
      label={project.name}
    />
  );
}

// Edge state is written straight to the DOM so scroll ticks never re-render
// the nav; same contract as SidePane's footer lift.
function useScrollEdgeState() {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollEl == null) {
      return;
    }
    const sync = () => {
      scrollEl.dataset.atTop = String(scrollEl.scrollTop <= 1);
      scrollEl.dataset.atBottom = String(
        scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1
      );
    };
    sync();
    scrollEl.addEventListener("scroll", sync, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(scrollEl);
    const scrollContent = scrollEl.firstElementChild;
    if (scrollContent != null) {
      observer?.observe(scrollContent);
    }
    return () => {
      scrollEl.removeEventListener("scroll", sync);
      observer?.disconnect();
    };
  }, [scrollEl]);
  return setScrollEl;
}

const AppSidebarProjectGroupsNav = memo(function AppSidebarProjectGroupsNav({
  currentProjectId,
  groups,
  projectIconKeys,
}: {
  currentProjectId: string | undefined;
  groups: ReturnType<typeof createAppSidebarProjectGroups>;
  projectIconKeys: ProjectIconKeyMap | undefined;
}) {
  const attachProjectsScroller = useScrollEdgeState();
  // Collapse state is deliberately session-only: a hidden Pinned group that
  // silently persists across reloads is easy to forget about.
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  return (
    <>
      {groups.pinned.length > 0 ? (
        <div className="shrink-0" data-slot="app-sidebar-pinned">
          <AppSidebarGroupHeading
            collapsed={pinnedCollapsed}
            onToggle={() => setPinnedCollapsed((value) => !value)}
          >
            Pinned
          </AppSidebarGroupHeading>
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
              pinnedCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="flex flex-col gap-0.5 group-data-[collapsible=icon]:gap-1.5">
                {groups.pinned.map((project) => (
                  <AppSidebarProjectRow
                    ariaLabel={`Pinned project: ${project.name}`}
                    currentProjectId={currentProjectId}
                    iconKey={projectIconKeys?.get(project.id) ?? "docker"}
                    key={project.id}
                    project={project}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {groups.projects.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <AppSidebarGroupHeading
            collapsed={projectsCollapsed}
            onToggle={() => setProjectsCollapsed((value) => !value)}
          >
            Projects
          </AppSidebarGroupHeading>
          <div
            className={cn(
              "grid min-h-0 flex-1 transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
              projectsCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
            )}
          >
            <div
              className="min-h-0 overflow-y-auto [--scroll-fade-bottom:0px] [--scroll-fade-top:0px] [mask-image:linear-gradient(to_bottom,transparent,black_var(--scroll-fade-top),black_calc(100%-var(--scroll-fade-bottom)),transparent)] data-[at-bottom=false]:[--scroll-fade-bottom:10px] data-[at-top=false]:[--scroll-fade-top:10px]"
              ref={attachProjectsScroller}
            >
              <div className="flex flex-col gap-0.5 py-1 group-data-[collapsible=icon]:gap-1.5">
                {groups.projects.map((project) => (
                  <AppSidebarProjectRow
                    currentProjectId={currentProjectId}
                    iconKey={projectIconKeys?.get(project.id) ?? "docker"}
                    key={project.id}
                    project={project}
                  />
                ))}
              </div>
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
    // preventScroll: while the expand animation is starting the collapse
    // button still sits in the clipped overflow, and a default focus() would
    // scroll the sidebar's inner surface sideways — a visible jump.
    document.querySelector<HTMLElement>(selector)?.focus({
      preventScroll: true,
    });
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
      className="app-sidebar-surface border-border"
      collapsible="icon"
      innerClassName="project-chrome-surface overflow-hidden"
    >
      {/* Collapsed rail: the account avatar disc is optically heavier than
          the stroke icons above it, so the rail takes extra bottom padding
          (and the account row a top margin) to even out the perceived gaps. */}
      <div className="flex h-full min-h-0 w-(--sidebar-width) flex-col px-2 py-2.5 transition-[padding] duration-200 ease-out group-data-[collapsible=icon]:pb-3.5 motion-reduce:transition-none">
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
                label="Projects"
              />
              <AppSidebarNotifications />
            </div>
            <AppSidebarProjectGroupsNav
              currentProjectId={currentProjectId}
              groups={groups}
              projectIconKeys={states.projectIconKeys}
            />
          </nav>
        </SidebarContent>
        <SidebarFooter className="p-0">
          <div className="flex shrink-0 flex-col gap-0.5 pt-3 group-data-[collapsible=icon]:gap-2">
            <AppSidebarNavRow
              active={billingActive}
              href="/billing"
              icon={
                <CreditCard aria-hidden className="size-4" strokeWidth={1.8} />
              }
              label="Billing"
              onClick={recordBillingReturnRoute}
            />
            <AppSidebarDesktopReturn />
            {/* The account row keeps 8px above it (footer gap + this
                  margin): the avatar disc is visually heavier than the row
                  glyphs, so it needs more breathing room than the 2px the
                  tightened footer rows get. The collapsed rail spaces the
                  account row itself (see AppSidebarAccount). */}
            <div className="mt-1.5 group-data-[collapsible=icon]:mt-0">
              <AppSidebarAccount />
            </div>
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
