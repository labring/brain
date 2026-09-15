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
import { AppSidebarWorkspaceSwitcher } from "@/features/shell/app-sidebar-workspace-switcher";
import { useReducedMotion } from "@/features/shell/use-reduced-motion";
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
          !active && "text-neutral-400 group-hover/row:text-blue-400"
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
        !active && "text-neutral-400 group-hover/row:text-blue-400"
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
    "group/row relative flex h-9 w-full shrink-0 items-center overflow-hidden rounded-md text-left text-neutral-50 text-sm";
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
          "relative flex w-9 shrink-0 items-center justify-center transition-colors group-hover/row:text-blue-400",
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

/**
 * The brand row (spec §C.1, CONTEXT.md App Sidebar): the logo slot is the
 * App Sidebar's only collapse / expand control. At rest it shows the Sealos
 * mark; while the pointer is anywhere over the sidebar, or the button has
 * focus, the mark crossfades into the PanelLeft glyph and the click
 * collapses (Expanded) or expands (Collapsed). One element in both states:
 * its `data-slot`, `aria-label`, and `aria-expanded` flip with the state,
 * so the focus transfer still lands on it and focus never leaves it after
 * a toggle. No wordmark, no separate collapse button; the tooltip only
 * exists in the Collapsed rail.
 *
 * Motion: the mark is an image and PanelLeft a path set, so there is no
 * true morph — the swap is a 200ms crossfade on `--ease-out-strong` with a
 * scale (0.8 ⇄ 1) and a 2px blur hint so the two read as one change.
 * Under `prefers-reduced-motion` only the opacity crossfade remains.
 * The hover variant is written out literally (`[[data-slot=sidebar-container]:hover_&]`)
 * so Tailwind's scanner sees the full class names.
 */
const BRAND_SWAP_TRANSITION =
  "transition-[opacity,scale,filter] duration-200 ease-out-strong";
const BRAND_SWAP_TRANSITION_REDUCED =
  "transition-opacity duration-200 ease-out-strong";
const LOGO_REST = "opacity-100";
const LOGO_REST_MOTION = "scale-100 blur-[0px]";
const LOGO_SWAPPED =
  "group-focus-visible/brand:opacity-0 [[data-slot=sidebar-container]:hover_&]:opacity-0";
const LOGO_SWAPPED_MOTION =
  "group-focus-visible/brand:scale-80 group-focus-visible/brand:blur-[2px] [[data-slot=sidebar-container]:hover_&]:scale-80 [[data-slot=sidebar-container]:hover_&]:blur-[2px]";
const GLYPH_REST = "opacity-0";
const GLYPH_REST_MOTION = "scale-80 blur-[2px]";
const GLYPH_SWAPPED =
  "group-focus-visible/brand:opacity-100 [[data-slot=sidebar-container]:hover_&]:opacity-100";
const GLYPH_SWAPPED_MOTION =
  "group-focus-visible/brand:scale-100 group-focus-visible/brand:blur-[0px] [[data-slot=sidebar-container]:hover_&]:scale-100 [[data-slot=sidebar-container]:hover_&]:blur-[0px]";

function AppSidebarHeader() {
  const { setOpen, state } = useSidebar();
  const expanded = state === "expanded";
  const reducedMotion = useReducedMotion();
  const label = expanded ? "Collapse sidebar" : "Expand sidebar";

  return (
    <div className="flex h-11 shrink-0 items-center">
      <Tooltip disabled={expanded}>
        <TooltipTrigger
          render={
            <AppIconButton
              aria-controls={APP_SIDEBAR_NAV_ID}
              aria-expanded={expanded}
              aria-label={label}
              className="group/brand shrink-0 border-0 text-neutral-50"
              data-slot={
                expanded ? "app-sidebar-collapse" : "app-sidebar-expand"
              }
              onClick={() => {
                setOpen(!expanded);
              }}
              size="lg"
              type="button"
              variant="quiet"
            >
              <span
                aria-hidden
                className="relative block size-5"
                data-slot="app-sidebar-brand"
              >
                <BrandLogo
                  className={cn(
                    "absolute inset-0 size-5",
                    LOGO_REST,
                    LOGO_SWAPPED,
                    reducedMotion
                      ? BRAND_SWAP_TRANSITION_REDUCED
                      : [
                          BRAND_SWAP_TRANSITION,
                          LOGO_REST_MOTION,
                          LOGO_SWAPPED_MOTION,
                        ]
                  )}
                />
                <PanelLeft
                  className={cn(
                    "absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2",
                    GLYPH_REST,
                    GLYPH_SWAPPED,
                    reducedMotion
                      ? BRAND_SWAP_TRANSITION_REDUCED
                      : [
                          BRAND_SWAP_TRANSITION,
                          GLYPH_REST_MOTION,
                          GLYPH_SWAPPED_MOTION,
                        ]
                  )}
                  strokeWidth={1.33}
                />
              </span>
            </AppIconButton>
          }
        />
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
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

  // Observe quota once credentials land. The shared Brain API client also
  // warms chat's quota cache (see project-workspace-layout); Status Hint
  // keeps observing on its polling cadence.
  useEffect(() => {
    if (appToken === "" || kubeconfig === "") {
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
          {/* Brand → Switcher 12px: 8px here plus the 4px the h-9 logo
              button leaves inside the h-11 brand row. */}
          <div className="mt-2">
            <AppSidebarWorkspaceSwitcher />
          </div>
        </SidebarHeader>
        <SidebarContent className="min-h-0 overflow-hidden p-0 group-data-[collapsible=icon]:overflow-hidden">
          <nav
            aria-label="Projects"
            className="flex min-h-0 flex-1 flex-col"
            id={APP_SIDEBAR_NAV_ID}
          >
            {/* Spacing rule — Expanded: rows 2px apart, sections 12px
                apart; Collapsed rail: rows 4px apart, sections 8px apart.
                Every gap below is one of those four values, with two
                documented exceptions: the account row (footer), and the
                Switcher → navigation gap here, which is 8px in both states
                (spec §C.2) so the top block reads as one unit above the
                navigation. */}
            <div className="flex flex-col gap-0.5 pt-2 transition-[gap,padding] duration-200 ease-out group-data-[collapsible=icon]:gap-1 motion-reduce:transition-none">
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
            {/* Billing and the Sealos Desktop Entry live inside the account
                popover; the account row is the whole footer. */}
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
