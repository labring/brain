"use client";

import { AppSelect } from "@workspace/ui/components/app-select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutContent,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import {
  CircuitBoard,
  Cpu,
  HardDrive,
  HdmiPort,
  type LucideIcon,
  MemoryStick,
  Network,
} from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import {
  type BillingQuotaType,
  type BillingUsageSnapshot,
  loadBillingUsage,
} from "@/features/billing/billing-usage-data";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
import { errorDescription } from "@/lib/toast-utils";

const SKELETON_ROW_KEYS = [
  "cpu",
  "memory",
  "storage",
  "nodeport",
  "traffic",
  "gpu",
] as const;

const QUOTA_ICONS = {
  cpu: Cpu,
  gpu: CircuitBoard,
  memory: MemoryStick,
  nodeport: HdmiPort,
  storage: HardDrive,
  traffic: Network,
} satisfies Record<BillingQuotaType, LucideIcon>;

interface BillingUsageSurfaceProps {
  error?: unknown;
  gpuEnabled: boolean;
  isLoading?: boolean;
  onWorkspaceChange?: (workspace: string) => void;
  snapshot?: BillingUsageSnapshot;
}

function UsageProgress({ value }: { value: number }) {
  const visibleValue = Math.min(100, Math.max(0, value));
  return (
    <div
      aria-label={`${value}% used`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={value}
      className="h-1 w-full max-w-40 overflow-hidden rounded-full bg-white/8"
      role="progressbar"
    >
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width]",
          visibleValue >= 90 && "bg-destructive"
        )}
        style={{ width: `${visibleValue}%` }}
      />
    </div>
  );
}

export function BillingUsageSurface({
  error,
  gpuEnabled,
  isLoading = false,
  onWorkspaceChange,
  snapshot,
}: BillingUsageSurfaceProps) {
  const rows =
    snapshot?.rows.filter((row) => gpuEnabled || row.type !== "gpu") ?? [];
  const workspaceOptions =
    snapshot?.workspaces.map((workspace) => ({
      label: workspace.name,
      value: workspace.id,
    })) ?? [];

  return (
    <div className="flex flex-col gap-4" data-slot="billing-usage-surface">
      <AppSelect
        aria-label="Workspace"
        className="w-full bg-input/30 px-3 sm:w-42"
        disabled={isLoading}
        emptyMessage="No workspaces"
        onValueChange={onWorkspaceChange}
        options={workspaceOptions}
        placeholder="Select workspace"
        searchable={workspaceOptions.length > 8}
        value={snapshot?.selectedWorkspace}
      />
      <TableLayout>
        <TableLayoutContent>
          <TableLayoutHeadRow>
            <TableHead className="w-1/5">Resource Name</TableHead>
            <TableHead className="w-1/5">Chart</TableHead>
            <TableHead className="w-1/5">Total</TableHead>
            <TableHead className="w-1/5">Used</TableHead>
            <TableHead className="w-1/5">Available</TableHead>
          </TableLayoutHeadRow>
          <TableLayoutBody>
            {isLoading
              ? SKELETON_ROW_KEYS.filter(
                  (key) => gpuEnabled || key !== "gpu"
                ).map((key, index) => (
                  <TableRow key={key}>
                    <TableCell className="h-13" colSpan={5}>
                      <Skeleton
                        aria-label={
                          index === 0 ? "Loading workspace usage" : undefined
                        }
                        className="h-4 w-full bg-white/8"
                      />
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {!isLoading && error != null ? (
              <TableRow>
                <TableCell
                  className="h-28 text-center text-destructive"
                  colSpan={5}
                  role="alert"
                >
                  {errorDescription(error, "Workspace usage is unavailable.")}
                </TableCell>
              </TableRow>
            ) : null}
            {!isLoading && error == null && rows.length === 0 ? (
              <TableRow>
                <TableCell
                  className="h-20 text-center text-muted-foreground"
                  colSpan={5}
                >
                  Please select a specific workspace
                </TableCell>
              </TableRow>
            ) : null}
            {!isLoading && error == null
              ? rows.map((row) => {
                  const Icon = QUOTA_ICONS[row.type];
                  return (
                    <TableRow key={row.type}>
                      <TableCell className="h-13">
                        <div className="flex items-center gap-2">
                          <Icon
                            aria-hidden
                            className="size-4 text-muted-foreground"
                          />
                          <span className="font-medium">{row.label}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <UsageProgress value={row.percentUsed} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.total}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.used}</TableCell>
                      <TableCell className="tabular-nums">
                        {row.remaining}
                      </TableCell>
                    </TableRow>
                  );
                })
              : null}
          </TableLayoutBody>
        </TableLayoutContent>
      </TableLayout>
    </div>
  );
}

export default function BillingUsage({ gpuEnabled }: { gpuEnabled: boolean }) {
  const appToken = useAtomValue(appTokenAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const currentWorkspace = useAtomValue(namespaceAtom).trim();
  const [selectedWorkspace, setSelectedWorkspace] = useState(currentWorkspace);
  const credentialsReady = appToken.trim() !== "" && kubeconfig.trim() !== "";
  const { data, error, isLoading } = useSWR(
    credentialsReady
      ? ["billing-usage", selectedWorkspace, appToken, kubeconfig]
      : null,
    () =>
      loadBillingUsage({
        appToken,
        kubeconfig,
        workspace: selectedWorkspace,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  return (
    <BillingUsageSurface
      error={error}
      gpuEnabled={gpuEnabled}
      isLoading={!credentialsReady || isLoading}
      onWorkspaceChange={setSelectedWorkspace}
      snapshot={data}
    />
  );
}
