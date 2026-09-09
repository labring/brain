"use client";

import "./entry-node.css";

import {
  EntryNodeAccess,
  EntryNodeContent,
  EntryNodeHeaderContent,
  EntryNodeOpen,
  EntryNodeStatus,
} from "./entry-node.content";
import {
  EntryNodeAddressLine,
  EntryNodeAddressRow,
  EntryNodeGroupBlock,
  EntryNodeGroupHeader,
  EntryNodeGroupList,
  EntryNodeHostText,
  EntryNodeSingleAddressBlock,
} from "./entry-node.group";
import { EntryNodeRoot } from "./entry-node.root";

// biome-ignore lint/performance/noBarrelFile: compound hook re-export for `import { useEntryNode }`
export {
  ENTRY_NODE_LABEL,
  ENTRY_NODE_OPEN_LABEL,
  ENTRY_NODE_OPEN_NOT_ACCESSIBLE_REASON,
  ENTRY_NODE_OPEN_NOT_CONFIGURED_REASON,
  entryNodeAddressCountLabel,
  entryNodeOpenDisabledReason,
} from "./entry-node.content";
export { useEntryNode } from "./entry-node.context";
export {
  entryNodeAddresses,
  resolveEntryNodeGroupsStatus,
  resolveEntryNodeTargetStatus,
  resolveEntryNodeTargetVisualStatus,
} from "./entry-node.status";
export type {
  EntryNodeActions,
  EntryNodeAddress,
  EntryNodeAddressKey,
  EntryNodeContextValue,
  EntryNodeCopyAddressHandler,
  EntryNodeGroup,
  EntryNodeMeta,
  EntryNodeOpenTarget,
  EntryNodeProviderProps,
  EntryNodeRootProps,
  EntryNodeState,
  EntryNodeStates,
  EntryNodeTargetStatus,
  EntryNodeTargetStatusTone,
} from "./entry-node.types";
export const EntryNode = {
  Access: EntryNodeAccess,
  AddressLine: EntryNodeAddressLine,
  AddressRow: EntryNodeAddressRow,
  Content: EntryNodeContent,
  Group: EntryNodeGroupBlock,
  GroupHeader: EntryNodeGroupHeader,
  GroupList: EntryNodeGroupList,
  HeaderContent: EntryNodeHeaderContent,
  HostText: EntryNodeHostText,
  Open: EntryNodeOpen,
  Root: EntryNodeRoot,
  SingleAddressBlock: EntryNodeSingleAddressBlock,
  Status: EntryNodeStatus,
} as const;

const dn = (component: object, name: string) => {
  (component as { displayName?: string }).displayName = name;
};

dn(EntryNodeRoot, "EntryNode.Root");
dn(EntryNodeContent, "EntryNode.Content");
dn(EntryNodeHeaderContent, "EntryNode.HeaderContent");
dn(EntryNodeAccess, "EntryNode.Access");
dn(EntryNodeOpen, "EntryNode.Open");
dn(EntryNodeStatus, "EntryNode.Status");
dn(EntryNodeGroupList, "EntryNode.GroupList");
dn(EntryNodeGroupBlock, "EntryNode.Group");
dn(EntryNodeGroupHeader, "EntryNode.GroupHeader");
dn(EntryNodeSingleAddressBlock, "EntryNode.SingleAddressBlock");
dn(EntryNodeAddressRow, "EntryNode.AddressRow");
dn(EntryNodeAddressLine, "EntryNode.AddressLine");
dn(EntryNodeHostText, "EntryNode.HostText");
