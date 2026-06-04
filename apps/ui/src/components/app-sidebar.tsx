"use client";

import { useApsK8sList, useDbsK8sList } from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { brainV2LogoSrc } from "@workspace/ui/assets/brand";
import {
  type DeviconKey,
  deviconSrc,
  devicons,
} from "@workspace/ui/assets/devicons";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentProps, type ReactNode, useMemo } from "react";
import { useProjectsExplorer } from "@/hooks/use-projects-explorer";
import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

interface WorkloadShortcutCandidate {
  createdAt: string;
  iconKey: DeviconKey;
  name: string;
  projectId: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return asRecord(asRecord(value)?.metadata) ?? {};
}

function metadataName(value: unknown): string {
  return nonEmptyString(metadataRecord(value).name) ?? "";
}

function metadataCreationTimestamp(value: unknown): string {
  return nonEmptyString(metadataRecord(value).creationTimestamp) ?? "";
}

function projectIdFromResource(value: unknown): string | undefined {
  const labels = asRecord(metadataRecord(value).labels);
  return nonEmptyString(labels?.[BRAIN_PROJECT_ID_LABEL]);
}

function databaseIconKeyFromSpec(spec: Record<string, unknown>): DeviconKey {
  const engine = nonEmptyString(spec.engine)?.toLowerCase();
  if (engine && engine in devicons && engine !== "docker") {
    return engine as DeviconKey;
  }

  return "docker";
}

function compareWorkloadCandidates(
  a: WorkloadShortcutCandidate,
  b: WorkloadShortcutCandidate
): number {
  const aTime = Date.parse(a.createdAt);
  const bTime = Date.parse(b.createdAt);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);

  if (aValid && bValid && aTime !== bTime) {
    return aTime - bTime;
  }
  if (aValid !== bValid) {
    return aValid ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

function selectedApByProject(
  data: K8sGetResponse | undefined
): Map<string, WorkloadShortcutCandidate> {
  const result = new Map<string, WorkloadShortcutCandidate>();

  for (const item of apItemsFromList(data)) {
    const projectId = projectIdFromResource(item);
    if (projectId === undefined) {
      continue;
    }

    const candidate: WorkloadShortcutCandidate = {
      createdAt: metadataCreationTimestamp(item),
      iconKey: "docker",
      name: metadataName(item),
      projectId,
    };
    const current = result.get(projectId);
    if (
      current === undefined ||
      compareWorkloadCandidates(candidate, current) < 0
    ) {
      result.set(projectId, candidate);
    }
  }

  return result;
}

function selectedDbByProject(
  data: K8sGetResponse | undefined
): Map<string, WorkloadShortcutCandidate> {
  const result = new Map<string, WorkloadShortcutCandidate>();

  for (const item of apItemsFromList(data)) {
    const projectId = projectIdFromResource(item);
    if (projectId === undefined) {
      continue;
    }

    const spec = asRecord(asRecord(item)?.spec) ?? {};
    const candidate: WorkloadShortcutCandidate = {
      createdAt: metadataCreationTimestamp(item),
      iconKey: databaseIconKeyFromSpec(spec),
      name: metadataName(item),
      projectId,
    };
    const current = result.get(projectId);
    if (
      current === undefined ||
      compareWorkloadCandidates(candidate, current) < 0
    ) {
      result.set(projectId, candidate);
    }
  }

  return result;
}

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

export default function AppSidebar() {
  const pathname = usePathname();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom);
  const currentProjectId = projectIdFromPathname(pathname);
  const projectsActive = pathname === "/project";

  const { states } = useProjectsExplorer({
    kubeconfig,
    ns: namespace,
  });

  const projectIdLabelExistence = BRAIN_PROJECT_ID_LABEL;
  const { data: apsData } = useApsK8sList({
    kubeconfig,
    labelSelector: projectIdLabelExistence,
    namespace,
  });
  const { data: dbsData } = useDbsK8sList({
    kubeconfig,
    labelSelector: projectIdLabelExistence,
    namespace,
  });
  const apByProject = useMemo(() => selectedApByProject(apsData), [apsData]);
  const dbByProject = useMemo(() => selectedDbByProject(dbsData), [dbsData]);

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
          className="flex min-h-0 w-9 flex-1 flex-col gap-1.5 overflow-y-auto"
        >
          <AppSidebarLinkButton
            active={projectsActive}
            aria-label="Projects"
            href="/project"
            tooltip="Projects"
          >
            <LayoutGrid aria-hidden className="size-4" strokeWidth={1.33} />
          </AppSidebarLinkButton>

          {states.projects.map((project) => {
            const ap = apByProject.get(project.id);
            const db =
              ap === undefined ? dbByProject.get(project.id) : undefined;
            const shortcut = ap ?? db;
            const iconKey = shortcut?.iconKey ?? "docker";
            const active = currentProjectId === project.id;

            return (
              <AppSidebarLinkButton
                active={active}
                aria-label={project.name}
                href={`/project/${encodeURIComponent(project.id)}`}
                key={project.id}
                tooltip={project.name}
              >
                <ProjectShortcutIcon active={active} iconKey={iconKey} />
              </AppSidebarLinkButton>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
