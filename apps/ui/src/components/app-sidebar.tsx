"use client";

import { useApsK8sList, useDbsK8sList } from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { PROJECT_UID_LABEL } from "@workspace/crossplane/constants";
import {
  type DeviconKey,
  deviconSrc,
  devicons,
} from "@workspace/ui/assets/devicons";
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
import { useMemo } from "react";
import { useProjectsExplorer } from "@/hooks/use-projects-explorer";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

interface WorkloadShortcutCandidate {
  createdAt: string;
  iconKey: DeviconKey;
  name: string;
  projectUid: string;
}

const SIDEBAR_ICON_BUTTON_CLASS =
  "flex size-9 items-center justify-center rounded-lg text-neutral-50 transition-colors hover:bg-white/15 focus-visible:outline-none";
const SIDEBAR_ICON_BUTTON_ACTIVE_CLASS = "bg-white/15";

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

function projectUidFromResource(value: unknown): string | undefined {
  const labels = asRecord(metadataRecord(value).labels);
  return nonEmptyString(labels?.[PROJECT_UID_LABEL]);
}

function compositionNameFromSpec(
  spec: Record<string, unknown>
): string | undefined {
  const crossplane = asRecord(spec.crossplane);
  const crossplaneCompositionRef = asRecord(crossplane?.compositionRef);
  const crossplaneCompositionName = nonEmptyString(
    crossplaneCompositionRef?.name
  );
  if (crossplaneCompositionName !== undefined) {
    return crossplaneCompositionName;
  }

  const compositionRef = asRecord(spec.compositionRef);
  return nonEmptyString(compositionRef?.name);
}

function databaseIconKeyFromSpec(spec: Record<string, unknown>): DeviconKey {
  const engine = nonEmptyString(spec.engine)?.toLowerCase();
  if (engine && engine in devicons && engine !== "docker") {
    return engine as DeviconKey;
  }

  const compositionName = compositionNameFromSpec(spec)?.toLowerCase() ?? "";
  for (const key of ["mongodb", "mysql", "postgresql", "redis"] as const) {
    if (compositionName.includes(key)) {
      return key;
    }
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
    const projectUid = projectUidFromResource(item);
    if (projectUid === undefined) {
      continue;
    }

    const candidate: WorkloadShortcutCandidate = {
      createdAt: metadataCreationTimestamp(item),
      iconKey: "docker",
      name: metadataName(item),
      projectUid,
    };
    const current = result.get(projectUid);
    if (
      current === undefined ||
      compareWorkloadCandidates(candidate, current) < 0
    ) {
      result.set(projectUid, candidate);
    }
  }

  return result;
}

function selectedDbByProject(
  data: K8sGetResponse | undefined
): Map<string, WorkloadShortcutCandidate> {
  const result = new Map<string, WorkloadShortcutCandidate>();

  for (const item of apItemsFromList(data)) {
    const projectUid = projectUidFromResource(item);
    if (projectUid === undefined) {
      continue;
    }

    const spec = asRecord(asRecord(item)?.spec) ?? {};
    const candidate: WorkloadShortcutCandidate = {
      createdAt: metadataCreationTimestamp(item),
      iconKey: databaseIconKeyFromSpec(spec),
      name: metadataName(item),
      projectUid,
    };
    const current = result.get(projectUid);
    if (
      current === undefined ||
      compareWorkloadCandidates(candidate, current) < 0
    ) {
      result.set(projectUid, candidate);
    }
  }

  return result;
}

function projectUidFromPathname(pathname: string): string | undefined {
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

function SealosLogo() {
  return (
    <svg aria-hidden className="size-4" fill="none" viewBox="0 0 16 16">
      <title>Sealos</title>
      <path
        d="M3.46465 7.52338C4.37618 8.85606 6.26563 8.73275 6.26563 8.73275C5.79706 8.27651 5.4888 7.85726 5.4518 6.67256C5.41481 5.48786 4.74895 5.16726 4.74895 5.16726C5.96306 4.40655 5.52579 3.57564 5.4888 2.65368C5.46603 2.08362 5.80655 1.65489 6.07024 1.41207C3.15733 1.84175 0.921671 4.35153 0.921671 7.38395C0.921671 7.59832 0.944435 7.79846 0.966251 8.00713C1.07818 7.70835 2.62237 6.29126 3.4656 7.52338H3.46465Z"
        fill="url(#sealos-logo-a)"
      />
      <path
        d="M13.7845 3.90384C13.1405 3.36129 12.449 3.22091 11.9169 3.22091C10.3926 3.22091 9.10735 4.46347 9.03337 5.98584C9.02958 6.05414 9.02957 6.10346 9.02957 6.16132C9.02957 6.26471 9.03906 6.37663 9.04665 6.46484C9.06088 6.61756 9.11305 6.86227 9.15004 7.07569C9.19462 7.33464 9.21359 7.47218 9.22307 7.74155C9.23161 8.00904 9.20695 8.29644 9.18039 8.47381C9.1396 8.75078 9.05329 9.08466 8.95275 9.33886C8.65206 10.1015 8.15883 10.7389 7.53091 11.1989C6.85841 11.6921 6.02656 11.9928 5.09511 11.9928C4.42166 11.9928 3.80512 11.8373 3.24929 11.5584C2.10253 10.9817 1.28016 9.91746 1.02596 8.58858C1.52773 11.9871 4.4966 14.588 8.03458 14.588C11.9245 14.588 15.0783 11.4341 15.0783 7.54426C15.0783 6.98843 15.0166 6.48951 14.9303 6.06647C14.8658 5.75061 14.7624 5.39492 14.6116 5.04396C14.4172 4.59152 14.1677 4.22729 13.7845 3.90384Z"
        fill="url(#sealos-logo-b)"
      />
      <mask
        height="12"
        id="sealos-logo-mask"
        maskUnits="userSpaceOnUse"
        style={{ maskType: "luminance" }}
        width="15"
        x="1"
        y="3"
      >
        <path
          d="M13.7845 3.90384C13.1405 3.36129 12.449 3.22091 11.9169 3.22091C10.3926 3.22091 9.10735 4.46347 9.03337 5.98584C9.02958 6.05414 9.02957 6.10346 9.02957 6.16132C9.02957 6.26471 9.03906 6.37663 9.04665 6.46484C9.06088 6.61756 9.11305 6.86227 9.15004 7.07569C9.19462 7.33464 9.21359 7.47218 9.22307 7.74155C9.23161 8.00904 9.20695 8.29644 9.18039 8.47381C9.1396 8.75078 9.05329 9.08466 8.95275 9.33886C8.65206 10.1015 8.15883 10.7389 7.53091 11.1989C6.85841 11.6921 6.02656 11.9928 5.09511 11.9928C4.42166 11.9928 3.80512 11.8373 3.24929 11.5584C2.10253 10.9817 1.28016 9.91746 1.02596 8.58858C1.52773 11.9871 4.4966 14.588 8.03458 14.588C11.9245 14.588 15.0783 11.4341 15.0783 7.54426C15.0783 6.98843 15.0166 6.48951 14.9303 6.06647C14.8658 5.75061 14.7624 5.39492 14.6116 5.04396C14.4172 4.59152 14.1677 4.22729 13.7845 3.90384Z"
          fill="white"
        />
      </mask>
      <g mask="url(#sealos-logo-mask)">
        <path
          d="M7.27192 13.2572C10.7 13.2572 13.479 10.4782 13.479 7.05009C13.479 3.62199 10.7 0.842968 7.27192 0.842968C3.84383 0.842968 1.06481 3.62199 1.06481 7.05009C1.06481 10.4782 3.84383 13.2572 7.27192 13.2572Z"
          fill="url(#sealos-logo-c)"
        />
      </g>
      <defs>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id="sealos-logo-a"
          x1="5.21909"
          x2="-0.711411"
          y1="0.584486"
          y2="9.93028"
        >
          <stop stopColor="#0AA3F9" />
          <stop offset="1" stopColor="#B5B4FF" />
        </linearGradient>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id="sealos-logo-b"
          x1="17.169"
          x2="7.74214"
          y1="14.9058"
          y2="2.77796"
        >
          <stop stopColor="#0AA3F9" />
          <stop offset="1" stopColor="#B5B4FF" />
        </linearGradient>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id="sealos-logo-c"
          x1="11.5776"
          x2="0.763467"
          y1="0.84607"
          y2="11.1107"
        >
          <stop stopColor="#7ABBFD" />
          <stop offset="1" stopColor="#7ABBFD" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function AppSidebar() {
  const pathname = usePathname();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom);
  const currentProjectUid = projectUidFromPathname(pathname);
  const projectsActive = pathname === "/project";

  const { states } = useProjectsExplorer({
    kubeconfig,
    ns: namespace,
  });

  const projectUidLabelExistence = PROJECT_UID_LABEL;
  const { data: apsData } = useApsK8sList({
    kubeconfig,
    labelSelector: projectUidLabelExistence,
    namespace,
  });
  const { data: dbsData } = useDbsK8sList({
    kubeconfig,
    labelSelector: projectUidLabelExistence,
    namespace,
  });
  const apByProject = useMemo(() => selectedApByProject(apsData), [apsData]);
  const dbByProject = useMemo(() => selectedDbByProject(dbsData), [dbsData]);

  return (
    <aside
      className="flex h-svh w-13 shrink-0 flex-col items-center border-white/10 border-r"
      data-slot="app-sidebar"
      style={{
        backgroundColor: "#101219",
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col items-start gap-3 px-2 py-2.5">
        <span
          aria-label="Sealos"
          className="flex size-9 shrink-0 items-center justify-center"
          role="img"
        >
          <SealosLogo />
        </span>

        <nav
          aria-label="Project shortcuts"
          className="flex min-h-0 w-9 flex-1 flex-col gap-1.5 overflow-y-auto"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  aria-label="More projects"
                  className={cn(
                    SIDEBAR_ICON_BUTTON_CLASS,
                    projectsActive && SIDEBAR_ICON_BUTTON_ACTIVE_CLASS
                  )}
                  href="/project"
                />
              }
            >
              <LayoutGrid aria-hidden className="size-4" strokeWidth={1.33} />
            </TooltipTrigger>
            <TooltipContent side="right">More projects</TooltipContent>
          </Tooltip>

          {states.projects.map((project) => {
            const ap = apByProject.get(project.id);
            const db =
              ap === undefined ? dbByProject.get(project.id) : undefined;
            const shortcut = ap ?? db;
            const iconKey = shortcut?.iconKey ?? "docker";
            const active = currentProjectUid === project.id;

            return (
              <Tooltip key={project.id}>
                <TooltipTrigger
                  render={
                    <Link
                      aria-label={project.name}
                      className={cn(
                        SIDEBAR_ICON_BUTTON_CLASS,
                        active && SIDEBAR_ICON_BUTTON_ACTIVE_CLASS
                      )}
                      href={`/project/${encodeURIComponent(project.id)}`}
                    />
                  }
                >
                  <ProjectShortcutIcon active={active} iconKey={iconKey} />
                </TooltipTrigger>
                <TooltipContent side="right">{project.name}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
