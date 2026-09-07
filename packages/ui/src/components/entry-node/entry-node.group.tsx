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
          headed={populated.length > 1 || group.name !== undefined}
          key={group.port}
        />
      ))}
    </div>
  );
}

/**
 * A group is headed by its port — written the way AP Network Settings writes
 * it (`game · 5200`, or `5200` alone) — except when the node has a single
 * unnamed port: then the header would name nothing the reader lacks, and the
 * block draws its addresses alone (`headed` false).
 *
 * A port with one Public Address is drawn like the Container node's Image
 * block: header line over value line, the whole block one copy hit-area.
 * A port with several draws the header once and gives every address its
 * own hover and hit-area beneath it.
 */
export function EntryNodeGroupBlock({
  className,
  group,
  headed = true,
}: {
  className?: string;
  group: EntryNodeGroup;
  /** Draw the port header; false for the node's single unnamed port. */
  headed?: boolean;
}) {
  const single = group.addresses.length === 1 ? group.addresses[0] : undefined;

  if (single !== undefined) {
    return (
      <EntryNodeSingleAddressBlock
        address={single}
        className={className}
        group={headed ? group : undefined}
        rowKey={getAddressKey(group, single, 0)}
      />
    );
  }

  return (
    <div
      className={cn(
        "entry-node-group flex min-w-0 flex-col gap-1 rounded-lg bg-zinc-950/20 px-1.5",
        headed ? "pt-2.5 pb-2" : "py-2",
        className
      )}
      data-slot="entry-node-group"
    >
      {headed ? <EntryNodeGroupHeader className="px-1" group={group} /> : null}
      {group.addresses.map((address, index) => {
        const rowKey = getAddressKey(group, address, index);
        return (
          <EntryNodeAddressRow address={address} key={rowKey} rowKey={rowKey} />
        );
      })}
    </div>
  );
}

export function EntryNodeGroupHeader({
  className,
  group,
}: {
  className?: string;
  group: Pick<EntryNodeGroup, "name" | "port">;
}) {
  return (
    <div
      className={cn(
        "flex h-4 min-w-0 items-center gap-1.5 text-xs leading-4",
        className
      )}
      data-slot="entry-node-group-header"
    >
      {group.name === undefined ? null : (
        <>
          <span className="min-w-0 truncate text-zinc-50">{group.name}</span>
          <span aria-hidden className="shrink-0 text-muted-foreground">
            ·
          </span>
        </>
      )}
      <span className="shrink-0 font-mono text-muted-foreground">
        {group.port}
      </span>
    </div>
  );
}

export function EntryNodeHostText({
  className,
  host,
}: Pick<EntryNodeAddress, "host"> & { className?: string }) {
  return <span className={cn("min-w-0 truncate", className)}>{host}</span>;
}

function addressCopyValue(address: EntryNodeAddress): string {
  return address.value?.trim() ?? "";
}

function useCopyAddressHandler(address: EntryNodeAddress, rowKey: string) {
  const { actions } = useEntryNode();
  return actions.copyAddress
    ? () => actions.copyAddress?.(address, rowKey)
    : undefined;
}

/**
 * The value line of one Public Address: status dot, hostname (a new-tab
 * link when the URL is http(s)) and the copy control. Pinned to `h-6` so the
 * hover-only copy button never dictates the line height. Must sit inside a
 * CanvasNode.CopyableRow.
 */
export function EntryNodeAddressLine({
  address,
  className,
  ...props
}: {
  address: EntryNodeAddress;
  className?: string;
  "data-slot"?: string;
}) {
  const visualStatus = resolveEntryNodeTargetVisualStatus(address.status);
  const value = addressCopyValue(address);
  const copyable = value !== "";

  return (
    <div
      className={cn(
        "entry-node-address-content pointer-events-none relative z-10 flex h-6 min-w-0 items-center gap-1.5 text-xs leading-4",
        copyable ? "text-zinc-50" : "text-muted-foreground",
        className
      )}
      {...props}
    >
      <CanvasNode.StatusDot size="small" status={visualStatus} />
      <CanvasNode.CopyableRowValue
        className="flex min-w-0 flex-1"
        href={copyable ? value : undefined}
      >
        <EntryNodeHostText host={address.host} />
      </CanvasNode.CopyableRowValue>
      <CanvasNode.CopyableRowActions label={value} />
    </div>
  );
}

/**
 * A port with exactly one Public Address: header + value, one hit-area.
 * Without `group` the header is skipped and the value stands alone.
 */
export function EntryNodeSingleAddressBlock({
  address,
  className,
  group,
  rowKey,
}: {
  address: EntryNodeAddress;
  className?: string;
  group?: Pick<EntryNodeGroup, "name" | "port">;
  rowKey: string;
}) {
  const value = addressCopyValue(address);
  const copyable = value !== "";

  return (
    <CanvasNode.CopyableRow
      className={cn(
        "entry-node-group entry-node-group-single relative flex min-w-0 flex-col gap-1.5 rounded-lg bg-zinc-950/20 p-2.5 transition-colors",
        className
      )}
      copyAriaLabel={`Copy ${value}`}
      copyable={copyable}
      copyValue={value}
      data-slot="entry-node-group"
      onCopy={useCopyAddressHandler(address, rowKey)}
      rowKey={rowKey}
      title={copyable ? value : undefined}
    >
      {group === undefined ? null : (
        <EntryNodeGroupHeader
          className="pointer-events-none relative z-10"
          group={group}
        />
      )}
      <EntryNodeAddressLine
        address={address}
        data-slot="entry-node-address-row"
      />
    </CanvasNode.CopyableRow>
  );
}

/** One Public Address under a shared port header: its own hover and hit-area. */
export function EntryNodeAddressRow({
  address,
  className,
  rowKey,
}: {
  address: EntryNodeAddress;
  className?: string;
  rowKey: string;
}) {
  const value = addressCopyValue(address);
  const copyable = value !== "";

  return (
    <CanvasNode.CopyableRow
      className={cn(
        "entry-node-address-row relative flex min-w-0 items-center rounded-md px-1 py-0.5 transition-colors",
        className
      )}
      copyAriaLabel={`Copy ${value}`}
      copyable={copyable}
      copyValue={value}
      data-slot="entry-node-address-row"
      onCopy={useCopyAddressHandler(address, rowKey)}
      rowKey={rowKey}
      title={copyable ? value : undefined}
    >
      <EntryNodeAddressLine address={address} className="flex-1" />
    </CanvasNode.CopyableRow>
  );
}
