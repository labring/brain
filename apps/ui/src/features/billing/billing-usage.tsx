"use client";

import { AppSelect } from "@workspace/ui/components/app-select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutCaption,
  TableLayoutContent,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import { useAtomValue } from "jotai";
import {
  CircuitBoard,
  Cpu,
  HardDrive,
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

const QUOTA_ICONS = {
  cpu: Cpu,
  gpu: CircuitBoard,
  memory: MemoryStick,
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
    <div className="flex min-w-40 items-center gap-3">
      <div
        aria-label={`${value}% used`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={value}
        className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${visibleValue}%` }}
        />
      </div>
      <span className="w-12 text-right text-muted-foreground text-xs tabular-nums">
        {value}%
      </span>
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
    <TableLayout data-slot="billing-usage-surface">
      <TableLayoutCaption className="flex-col gap-3 sm:flex-row">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-medium text-foreground">Workspace usage</h2>
          <span className="text-muted-foreground text-xs">
            Current quota allocation
          </span>
        </div>
        <AppSelect
          aria-label="Workspace"
          className="w-full sm:w-56"
          disabled={isLoading}
          emptyMessage="No workspaces"
          onValueChange={onWorkspaceChange}
          options={workspaceOptions}
          placeholder="Select workspace"
          searchable={workspaceOptions.length > 8}
          value={snapshot?.selectedWorkspace}
        />
      </TableLayoutCaption>

      <TableLayoutContent>
        <TableLayoutHeadRow>
          <TableHead className="w-1/5">Resource</TableHead>
          <TableHead className="w-1/5">Usage</TableHead>
          <TableHead className="w-1/5">Total</TableHead>
          <TableHead className="w-1/5">Used</TableHead>
          <TableHead className="w-1/5">Remaining</TableHead>
        </TableLayoutHeadRow>
        <TableLayoutBody>
          {isLoading ? (
            <TableRow>
              <TableCell className="h-28" colSpan={5}>
                <Skeleton
                  aria-label="Loading workspace usage"
                  className="h-8 w-full"
                />
              </TableCell>
            </TableRow>
          ) : null}
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
                className="h-28 text-center text-muted-foreground"
                colSpan={5}
              >
                Select a workspace to view quota usage.
              </TableCell>
            </TableRow>
          ) : null}
          {!isLoading && error == null
            ? rows.map((row) => {
                const Icon = QUOTA_ICONS[row.type];
                return (
                  <TableRow key={row.type}>
                    <TableCell className="h-14">
                      <div className="flex items-center gap-2.5">
                        <Icon
                          aria-hidden
                          className="size-4 text-muted-foreground"
                          strokeWidth={1.75}
                        />
                        <span className="font-medium">{row.label}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <UsageProgress value={row.percentUsed} />
                    </TableCell>
                    <TableCell className="tabular-nums">{row.total}</TableCell>
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
