"use client";

import { brainV2LogoSrc } from "@workspace/ui/assets/brand";
import {
  type DeviconKey,
  deviconSrc,
  devicons,
} from "@workspace/ui/assets/devicons";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { LayoutGrid, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createProjectSidebarShortcutItems } from "@/components/app-sidebar.shortcuts";
import { useLastViewedProject } from "@/hooks/use-last-viewed-project";
import { useProjectsExplorer } from "@/hooks/use-projects-explorer";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

function projectIdFromPathname(pathname: string): string | undefined {
  const prefix = "/project/";
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  const encoded = pathname.slice(prefix.length).split("/")[0];
  if (!encoded) {
    return undefined;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function ProjectShortcutIcon({
  active,
  iconKey,
}: {
  active?: boolean;
  iconKey: DeviconKey;
}) {
  const icon = devicons[iconKey];
  const src = deviconSrc(
    active || iconKey === "mysql" ? icon.original : icon.plain
  );

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

const APP_SIDEBAR_LINK_CLASS =
  "shrink-0 border-0 text-neutral-50 active:translate-y-0! aria-[current=page]:text-blue-400!";
const EMPTY_PROJECT_IDS: readonly string[] = Object.freeze([]);

const UPGRADE_USAGE_ROWS = [
  ["CPU", "0.0/0"],
  ["Memory", "0.0/0"],
  ["Storage", "0.0/0"],
  ["Ports", "0.0/0"],
] as const;

type AppSidebarLinkButtonProps = Pick<
  ComponentProps<typeof AppIconButton>,
  "aria-label" | "children"
> &
  Pick<ComponentProps<typeof Link>, "href"> & {
    active?: boolean;
    tooltip: ReactNode;
  };

function AppSidebarLinkButton({
  active,
  "aria-label": ariaLabel,
  children,
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
            className={APP_SIDEBAR_LINK_CLASS}
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

function BrainV2Logo() {
  return (
    <span
      aria-hidden
      className="block size-full bg-center bg-contain bg-no-repeat"
      style={{ backgroundImage: `url(${JSON.stringify(brainV2LogoSrc)})` }}
    />
  );
}

function AppSidebarUpgrade() {
  const [open, setOpen] = useState(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <AppIconButton
            aria-expanded={open}
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
            {UPGRADE_USAGE_ROWS.map(([label, value]) => (
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

          <AppButton className="w-full" type="button" variant="secondary">
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

export default function AppSidebar() {
  const pathname = usePathname();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom);
  const currentProjectId = projectIdFromPathname(pathname);
  const projectsActive = pathname === "/project";
  const { lastViewedProjectId, setLastViewedProject } =
    useLastViewedProject(namespace);
  const handledProjectRouteId = useRef<string | undefined>(undefined);

  const { states } = useProjectsExplorer({
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
      className="project-chrome-surface flex h-svh w-13 shrink-0 flex-col items-center border-white/10 border-r"
      data-slot="app-sidebar"
    >
      <div className="flex min-h-0 flex-1 flex-col items-start gap-3 px-2 py-2.5">
        <span
          aria-label="Brain v2"
          className="flex size-9 shrink-0 items-center justify-center"
          role="img"
        >
          <BrainV2Logo />
        </span>

        <nav
          aria-label="Project shortcuts"
          className="flex min-h-0 w-9 flex-1 flex-col gap-1.5"
        >
          <AppSidebarLinkButton
            active={projectsActive}
            aria-label="Projects"
            href="/project"
            tooltip="Projects"
          >
            <LayoutGrid aria-hidden className="size-4" strokeWidth={1.33} />
          </AppSidebarLinkButton>

          <div
            className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
            data-slot="app-sidebar-project-shortcuts"
          >
            {projectShortcutItems.map((item) => {
              const { project } = item;
              const iconKey =
                projectShortcutIconKeys?.get(project.id) ?? "docker";
              const active = currentProjectId === project.id;
              const ariaLabel =
                item.kind === "lastViewed"
                  ? `Last viewed unpinned project: ${project.name}`
                  : `Pinned project: ${project.name}`;

              return (
                <AppSidebarLinkButton
                  active={active}
                  aria-label={ariaLabel}
                  href={`/project/${encodeURIComponent(project.id)}`}
                  key={`${item.kind}:${project.id}`}
                  tooltip={project.name}
                >
                  <ProjectShortcutIcon active={active} iconKey={iconKey} />
                </AppSidebarLinkButton>
              );
            })}
          </div>
        </nav>

        <AppSidebarUpgrade />
      </div>
    </aside>
  );
}
