"use client";

import "./container-node.css";

import {
  ContainerNodeActionBar,
  ContainerNodeBodyContent,
  ContainerNodeContent,
  ContainerNodeFooterContent,
  ContainerNodeHeaderContent,
  ContainerNodeImageRow,
  ContainerNodeMetricsContent,
} from "./container-node.content";
import { ContainerNodeRoot } from "./container-node.root";

// biome-ignore lint/performance/noBarrelFile: compound component public API includes colocated helpers.
export {
  ContainerNodeActionBar,
  ContainerNodeBodyContent,
  ContainerNodeContent,
  ContainerNodeFooterContent,
  ContainerNodeHeaderContent,
  ContainerNodeImageRow,
  ContainerNodeMetricsContent,
} from "./container-node.content";
export { useContainerNode } from "./container-node.context";
export { containerNodeLifecycleMenuVisibility } from "./container-node.menu-visibility";
export { ContainerNodeRoot } from "./container-node.root";
export {
  resolveContainerNodeStatus,
  resolveContainerNodeVisualTone,
} from "./container-node.status";
export type {
  ContainerNodeAction,
  ContainerNodeActions,
  ContainerNodeContextValue,
  ContainerNodeLifecycleActionKey,
  ContainerNodeLifecycleActions,
  ContainerNodeMetricKey,
  ContainerNodeMetricValue,
  ContainerNodeProviderProps,
  ContainerNodeQuickActionKey,
  ContainerNodeQuickActions,
  ContainerNodeRootProps,
  ContainerNodeState,
  ContainerNodeStates,
  ContainerNodeStatus,
  ContainerNodeStatusTone,
} from "./container-node.types";

export const ContainerNode = {
  ActionBar: ContainerNodeActionBar,
  BodyContent: ContainerNodeBodyContent,
  Content: ContainerNodeContent,
  FooterContent: ContainerNodeFooterContent,
  HeaderContent: ContainerNodeHeaderContent,
  ImageRow: ContainerNodeImageRow,
  MetricsContent: ContainerNodeMetricsContent,
  Root: ContainerNodeRoot,
} as const;

const dn = (component: object, name: string) => {
  (component as { displayName?: string }).displayName = name;
};

dn(ContainerNodeRoot, "ContainerNode.Root");
dn(ContainerNodeContent, "ContainerNode.Content");
dn(ContainerNodeHeaderContent, "ContainerNode.HeaderContent");
dn(ContainerNodeBodyContent, "ContainerNode.BodyContent");
dn(ContainerNodeImageRow, "ContainerNode.ImageRow");
dn(ContainerNodeActionBar, "ContainerNode.ActionBar");
dn(ContainerNodeFooterContent, "ContainerNode.FooterContent");
dn(ContainerNodeMetricsContent, "ContainerNode.MetricsContent");
