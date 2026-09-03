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
import { ThemeToggle } from "@workspace/ui/components/theme-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { ChevronRight, Database, PanelLeft, PanelsTopLeft } from "lucide-react";
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
import { loadWorkspaceQuotaSnapshot } from "@/features/billing/workspace-quota-client";
import { observeWorkspaceQuotaForInbox } from "@/features/notifications/quota-observation";
import { projectIdFromPathname } from "@/features/panes/use-project-id";
import { useProjectsExplorerReadModel } from "@/features/projects/explorer/use-projects-explorer";
import type {
  ProjectIconKey,
  ProjectIconKeyMap,
} from "@/features/projects/project-icons";
import { createAppSidebarProjectGroups } from "@/features/shell/app-sidebar.groups";
import { AppSidebarAccount } from "@/features/shell/app-sidebar-account";
import { AppSidebarNotifications } from "@/features/shell/app-sidebar-notifications";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

const APP_SIDEBAR_NAV_ID = "app-sidebar-nav";
const APP_SIDEBAR_WIDTH = "13.75rem";
const APP_SIDEBAR_WIDTH_ICON = "3.25rem";
const EMPTY_PROJECT_IDS: readonly string[] = Object.freeze([]);

// The inactive tint sets its own color, which beats the icon slot's inherited
// hover blue — so the row's group-hover must be restated here (`group/row`
// comes from AppSidebarNavRow).
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
          !active &&
            "text-muted-foreground group-hover/row:text-blue-600 dark:group-hover/row:text-blue-400"
        )}
        strokeWidth={1.8}
      />
    );
  }

  return (
    <BrandMark
      brandKey={iconKey}
      className={cn(
        "transition-colors",
        !active &&
          "text-muted-foreground group-hover/row:text-blue-600 dark:group-hover/row:text-blue-400"
      )}
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
    "group/row relative flex h-9 w-full shrink-0 items-center overflow-hidden rounded-md text-left text-foreground text-sm";
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
          "relative flex w-9 shrink-0 items-center justify-center transition-colors group-hover/row:text-blue-600 dark:group-hover/row:text-blue-400",
          active && "text-blue-600 dark:text-blue-400"
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

// Footer row for the theme switch, mirroring AppSidebarNavRow's geometry so
// the icon column, hover sheet, and collapsed-rail tooltip anchor match the
// Projects/Notifications rows above it. The row itself IS the toggle button
// (AnimatedThemeToggler renders a button) — no nested interactive element.
function AppSidebarThemeToggleRow() {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const iconSlotRef = useRef<HTMLSpanElement>(null);

  return (
    <Tooltip disabled={expanded}>
      <TooltipTrigger
        render={
          <ThemeToggle
            aria-label="Toggle theme"
            className={cn(
              "group/row relative isolate flex h-9 w-full shrink-0 cursor-pointer items-center overflow-hidden rounded-md text-left text-sm",
              // Semantic so the row follows the theme; in dark,
              // --foreground is exactly the rows' near-white above it.
              "text-foreground"
            )}
            data-slot="app-sidebar-theme-toggle"
            iconClassName={cn(
              // Match AppSidebarNavRow's icon column: a w-9 centered slot.
              "relative size-9 w-9 shrink-0",
              "transition-colors group-hover/row:text-blue-600 dark:group-hover/row:text-blue-400"
            )}
            iconRef={iconSlotRef}
            title={expanded ? "Theme" : undefined}
          >
            {/* Same hover sheet as AppSidebarNavRow; -z-10 inside the row's
                isolate keeps it under the icon/label without DOM reorder. */}
            <span
              aria-hidden
              className={cn(
                "app-sidebar-hover absolute inset-y-0 left-0 -z-10 rounded-md transition-[width,background-color] group-hover/row:bg-input/30 motion-reduce:transition-none",
                expanded
                  ? "w-full duration-300 ease-sidebar"
                  : "w-9 duration-200 ease-out"
              )}
            />
            <span
              className={cn(
                "app-sidebar-label relative min-w-0 flex-1 truncate whitespace-nowrap pr-2 transition-opacity motion-reduce:transition-none",
                expanded
                  ? "opacity-100 duration-300 ease-sidebar"
                  : "opacity-0 duration-200 ease-out"
              )}
            >
              Theme
            </span>
          </ThemeToggle>
        }
      />
      <TooltipContent anchor={iconSlotRef} side="right">
        Theme
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
        expanded ? "h-6 duration-300 ease-sidebar" : "h-4 duration-200 ease-out"
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
        <span className="flex min-w-0 flex-1 items-center gap-1 pl-2 font-medium text-muted-foreground text-xs transition-colors group-hover/heading:text-foreground dark:group-hover/heading:text-neutral-300">
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
          "group/expand shrink-0 border-0 text-foreground",
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
          "min-w-0 flex-1 truncate whitespace-nowrap font-semibold text-foreground text-sm transition-opacity motion-reduce:transition-none",
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
          "shrink-0 border-0 text-foreground transition-opacity motion-reduce:transition-none",
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

function AppSidebarProjectRow({
  ariaLabel,
  currentProjectId,
  iconKey,
  inert,
  project,
}: {
  ariaLabel?: string;
  currentProjectId: string | undefined;
  iconKey: ProjectIconKey;
  /** Renders the row without a link (Projects Dev Mock fixture rows). */
  inert?: boolean;
  project: { id: string; name: string };
}) {
  const active = currentProjectId === project.id;
  return (
    <AppSidebarNavRow
      active={active}
      ariaLabel={ariaLabel}
      href={inert ? undefined : `/project/${encodeURIComponent(project.id)}`}
      icon={<ProjectIcon active={active} iconKey={iconKey} />}
      label={project.name}
    />
  );
}

// Edge state is written straight to the DOM so scroll ticks never re-render
// the nav; same contract as SidePane's footer lift.
function useScrollEdgeState() {
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const attachScrollEl = useCallback((node: HTMLDivElement | null) => {
    scrollElRef.current = node;
    setScrollEl(node);
  }, []);
  useEffect(() => {
    if (scrollEl == null) {
      return;
    }
    const sync = () => {
      const el = scrollElRef.current;
      if (el == null) {
        return;
      }
      el.dataset.atTop = String(el.scrollTop <= 1);
      el.dataset.atBottom = String(
        el.scrollTop + el.clientHeight >= el.scrollHeight - 1
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
  return attachScrollEl;
}

const AppSidebarProjectGroupsNav = memo(function AppSidebarProjectGroupsNav({
  currentProjectId,
  groups,
  projectIconKeys,
  rowsInert,
}: {
  currentProjectId: string | undefined;
  groups: ReturnType<typeof createAppSidebarProjectGroups>;
  projectIconKeys: ProjectIconKeyMap | undefined;
  /** True while the Projects Dev Mock is on: fixture rows must not navigate. */
  rowsInert?: boolean;
}) {
  const attachProjectsScroller = useScrollEdgeState();
  const { state } = useSidebar();
  // Collapse state is deliberately session-only: a hidden Pinned group that
  // silently persists across reloads is easy to forget about.
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  // On the icon rail the headings are inert, so a collapsed group would
  // strand its project icons with no way to reopen them. Render every group
  // open while the sidebar is collapsed; the session flags come back when
  // it expands.
  const iconMode = state === "collapsed";
  const pinnedHidden = pinnedCollapsed && !iconMode;
  const projectsHidden = projectsCollapsed && !iconMode;
  return (
    <>
      {groups.pinned.length > 0 ? (
        <div
          className="shrink-0 pt-3 transition-[gap,padding] duration-200 ease-out group-data-[collapsible=icon]:pt-0 motion-reduce:transition-none"
          data-slot="app-sidebar-pinned"
        >
          <AppSidebarGroupHeading
            collapsed={pinnedHidden}
            onToggle={() => setPinnedCollapsed((value) => !value)}
          >
            Pinned
          </AppSidebarGroupHeading>
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
              pinnedHidden ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="flex flex-col gap-0.5 pt-0.5 transition-[gap,padding] duration-200 ease-out group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:pt-0 motion-reduce:transition-none">
                {groups.pinned.map((project) => (
                  <AppSidebarProjectRow
                    ariaLabel={`Pinned project: ${project.name}`}
                    currentProjectId={currentProjectId}
                    iconKey={projectIconKeys?.get(project.id) ?? "docker"}
                    inert={rowsInert}
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
        <div className="flex min-h-0 flex-1 flex-col pt-3 transition-[gap,padding] duration-200 ease-out group-data-[collapsible=icon]:pt-0 motion-reduce:transition-none">
          <AppSidebarGroupHeading
            collapsed={projectsHidden}
            onToggle={() => setProjectsCollapsed((value) => !value)}
          >
            Projects
          </AppSidebarGroupHeading>
          <div
            className={cn(
              "grid min-h-0 flex-1 transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
              projectsHidden ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
            )}
          >
            <div
              className="min-h-0 overflow-y-auto [--scroll-fade-bottom:0px] [--scroll-fade-top:0px] [mask-image:linear-gradient(to_bottom,transparent,black_var(--scroll-fade-top),black_calc(100%-var(--scroll-fade-bottom)),transparent)] data-[at-bottom=false]:[--scroll-fade-bottom:10px] data-[at-top=false]:[--scroll-fade-top:10px]"
              ref={attachProjectsScroller}
            >
              {/* pb-1 is scroll-fade headroom, not list spacing */}
              <div className="flex flex-col gap-0.5 pt-0.5 pb-1 transition-[gap,padding] duration-200 ease-out group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:pt-0 motion-reduce:transition-none">
                {groups.projects.map((project) => (
                  <AppSidebarProjectRow
                    currentProjectId={currentProjectId}
                    iconKey={projectIconKeys?.get(project.id) ?? "docker"}
                    inert={rowsInert}
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
    // Only hand focus over when it was already inside the sidebar — the
    // toggle button the user pressed goes inert after the flip. A
    // Cmd/Ctrl+B from the canvas or main view must not yank focus into
    // the rail.
    if (!document.activeElement?.closest('[data-slot="sidebar"]')) {
      return;
    }
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
  currentProjectId,
  projectsActive,
}: {
  currentProjectId: string | undefined;
  projectsActive: boolean;
}) {
  const appToken = useAtomValue(appTokenAtom).trim();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom);
  const { devMockActive, states } = useProjectsExplorerReadModel({
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

  // Warm the workspace-quota cache so chat turns can inject the snapshot
  // without waiting on the desktop SDK (see project-workspace-layout), and
  // let the quota-exhausted producer observe the first snapshot; the Status
  // Hint keeps observing on its polling cadence.
  useEffect(() => {
    if (appToken === "" || kubeconfig === "") {
      loadWorkspaceQuotaSnapshot(namespace).catch(() => undefined);
      return;
    }
    observeWorkspaceQuotaForInbox({ appToken, kubeconfig, namespace }).catch(
      () => undefined
    );
  }, [appToken, kubeconfig, namespace]);

  return (
    <Sidebar
      className="app-sidebar-surface border-border"
      collapsible="icon"
      innerClassName="project-chrome-surface overflow-hidden"
    >
      {/* Collapsed rail: the account avatar disc is optically heavier than
          the stroke icons above it, so the rail takes extra bottom padding
          to even out the perceived gap. */}
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
            {/* Spacing rule — Expanded: rows 2px apart, sections 12px
                apart; Collapsed rail: rows 4px apart, sections 8px apart.
                Every gap below is one of those four values (the account row
                is the documented exception). */}
            <div className="flex flex-col gap-0.5 pt-3 transition-[gap,padding] duration-200 ease-out group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:pt-2 motion-reduce:transition-none">
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
              rowsInert={devMockActive}
            />
          </nav>
        </SidebarContent>
        <SidebarFooter className="p-0">
          <div className="flex shrink-0 flex-col gap-0.5 pt-3 transition-[gap,padding] duration-200 ease-out group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:pt-2 motion-reduce:transition-none">
            <AppSidebarThemeToggleRow />
            {/* Billing and the Sealos Desktop Entry live inside the account
                popover. */}
            {/* Account-row exception: the avatar disc is visually heavier
                  than the row glyphs, so in both states it takes this extra
                  margin on top of the footer gap. */}
            <div className="mt-1">
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
  defaultOpen = false,
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
      currentProjectId={projectIdFromPathname(pathname)}
      projectsActive={pathname === "/project"}
    />
  );
}
