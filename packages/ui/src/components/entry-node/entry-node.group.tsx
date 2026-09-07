"use client";

import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import { cn } from "@workspace/ui/lib/utils";

import { useEntryNode } from "./entry-node.context";
import { resolveEntryNodeTargetVisualStatus } from "./entry-node.status";
import type { EntryNodeAddress, EntryNodeGroup } from "./entry-node.types";

function getAddressKey(
  group: EntryNodeGroup,
  address: EntryNodeAddress,
  index: number
) {
  return address.id ?? `${group.port}-${index}`;
}

/**
 * A group header is drawn whenever there is something to tell apart: more
 * than one port, or a single port that carries a name. A lone unnamed port
 * draws none, so single-port APs look exactly as before.
 */
export function entryNodeShowsGroupHeaders(
  groups: readonly EntryNodeGroup[]
): boolean {
  return groups.length > 1 || groups.some((group) => group.name !== undefined);
}

export function EntryNodeGroupList({ className }: { className?: string }) {
  const {
    state: { groups = [] },
  } = useEntryNode();
  const populated = groups.filter((group) => group.addresses.length > 0);

  if (populated.length === 0) {
    return (
      <div
        className={cn(
          "entry-node-target-empty mt-2.5 flex min-w-0 items-center rounded-lg bg-zinc-950/20 px-2.5 text-muted-foreground text-xs leading-4",
          className
        )}
        data-slot="entry-node-target-empty"
      >
        Not configured
      </div>
    );
  }

  const showHeaders = entryNodeShowsGroupHeaders(populated);

  return (
    <div
      className={cn(
        "entry-node-group-list mt-2.5 flex min-w-0 flex-col gap-1.5",
        className
      )}
      data-slot="entry-node-group-list"
    >
      {populated.map((group) => (
        <EntryNodeGroupBlock
          group={group}
          key={group.port}
          showHeader={showHeaders}
        />
      ))}
    </div>
  );
}

export function EntryNodeGroupBlock({
  className,
  group,
  showHeader,
}: {
  className?: string;
  group: EntryNodeGroup;
  showHeader: boolean;
}) {
  return (
    <div
      className={cn(
        "entry-node-group flex min-w-0 flex-col gap-0.5 rounded-lg bg-zinc-950/20 p-1",
        className
      )}
      data-slot="entry-node-group"
    >
      {showHeader ? (
        <div
          className="flex min-w-0 items-baseline gap-1.5 px-2 pt-1 pb-0.5 text-xs leading-4"
          data-slot="entry-node-group-header"
        >
          {group.name === undefined ? null : (
            <span className="min-w-0 truncate text-zinc-50">{group.name}</span>
          )}
          <span className="shrink-0 font-mono text-muted-foreground">
            :{group.port}
          </span>
        </div>
      ) : null}
      {group.addresses.map((address, index) => (
        <EntryNodeAddressRow
          address={address}
          key={getAddressKey(group, address, index)}
          rowKey={getAddressKey(group, address, index)}
        />
      ))}
    </div>
  );
}

export function EntryNodeHostText({
  className,
  host,
  hostSuffix,
}: Pick<EntryNodeAddress, "host" | "hostSuffix"> & { className?: string }) {
  const suffix =
    hostSuffix !== undefined &&
    hostSuffix !== "" &&
    host.length > hostSuffix.length &&
    host.endsWith(hostSuffix)
      ? hostSuffix
      : undefined;

  if (suffix === undefined) {
    return <span className={cn("min-w-0 truncate", className)}>{host}</span>;
  }

  return (
    <span className={cn("flex min-w-0 items-baseline", className)}>
      <span className="shrink-0">{host.slice(0, -suffix.length)}</span>
      <span
        className="min-w-0 truncate text-muted-foreground"
        data-slot="entry-node-host-suffix"
      >
        {suffix}
      </span>
    </span>
  );
}

export function EntryNodeAddressRow({
  address,
  className,
  rowKey,
}: {
  address: EntryNodeAddress;
  className?: string;
  rowKey: string;
}) {
  const { actions } = useEntryNode();
  const visualStatus = resolveEntryNodeTargetVisualStatus(address.status);
  const value = address.value?.trim() ?? "";
  const copyable = value !== "";

  return (
    <CanvasNode.CopyableRow
      className={cn(
        "entry-node-address-row relative flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
        copyable && "hover:bg-white/5",
        className
      )}
      copyAriaLabel={`Copy ${value}`}
      copyable={copyable}
      copyValue={value}
      data-slot="entry-node-address-row"
      onCopy={
        actions.copyAddress
          ? () => actions.copyAddress?.(address, rowKey)
          : undefined
      }
      rowKey={rowKey}
      title={copyable ? value : undefined}
    >
      <div className="entry-node-address-content pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1.5 text-xs text-zinc-50 leading-4">
        <CanvasNode.StatusDot size="small" status={visualStatus} />
        <CanvasNode.CopyableRowValue
          className="flex min-w-0 flex-1"
          href={copyable ? value : undefined}
        >
          <EntryNodeHostText
            host={address.host}
            hostSuffix={address.hostSuffix}
          />
        </CanvasNode.CopyableRowValue>
        <CanvasNode.CopyableRowActions label={value} />
      </div>
    </CanvasNode.CopyableRow>
  );
}
