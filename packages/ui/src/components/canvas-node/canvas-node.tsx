"use client";

import "./canvas-node.css";

import {
  CanvasNodeActionBar,
  CanvasNodeActionButton,
  CanvasNodeActionMenu,
  CanvasNodeActionMenuItem,
} from "./canvas-node.actions";
import { CanvasNodeCard } from "./canvas-node.card";
import { CanvasNodeConnectionAnchor } from "./canvas-node.connection";
import {
  CanvasNodeCopyableRow,
  CanvasNodeCopyableRowControl,
  CanvasNodeCopyableRowIndicator,
  CanvasNodeCopyFeedbackScope,
} from "./canvas-node.copyable-row";
import { CanvasNodeCopyableRowValue } from "./canvas-node.copyable-row-value";
import {
  CanvasNodeDragFrame,
  CanvasNodeDragStateFrame,
} from "./canvas-node.drag-frame";
import { CanvasNodeExpandButton } from "./canvas-node.expand-button";
import { CanvasNodeFrame } from "./canvas-node.frame";
import {
  CanvasNodeBody,
  CanvasNodeFooter,
  CanvasNodeHeader,
} from "./canvas-node.layout";
import {
  CanvasNodeFooterStatus,
  CanvasNodeMetric,
  CanvasNodeMetricList,
  CanvasNodeMetrics,
} from "./canvas-node.metrics";
import { CanvasNodePlaceholder } from "./canvas-node.placeholder";
import { CanvasNodeRoot } from "./canvas-node.root";
import { CanvasNodeCopyableRowActions } from "./canvas-node.row-actions";
import {
  CanvasNodeStatus,
  CanvasNodeStatusDot,
  CanvasNodeStatusPill,
} from "./canvas-node.status";
import { CanvasNodeSurface } from "./canvas-node.surface";

export type { CanvasNodeConnectionAnchorProps } from "./canvas-node.connection";
export type {
  CanvasNodeCopyableRowKey,
  CanvasNodeCopyableRowProps,
  CanvasNodeCopyableRowState,
  CanvasNodeCopyFeedbackScopeProps,
  CanvasNodeCopyFeedbackValue,
} from "./canvas-node.copyable-row";
export type { CanvasNodeCopyableRowValueProps } from "./canvas-node.copyable-row-value";
export type {
  CanvasNodeMetricListItem,
  CanvasNodeMetricListProps,
  CanvasNodeMetricRecord,
  CanvasNodeMetricValue,
  CanvasNodeMetricValueFormat,
} from "./canvas-node.metrics";
export type { CanvasNodePlaceholderProps } from "./canvas-node.placeholder";
export type { CanvasNodeCopyableRowActionsProps } from "./canvas-node.row-actions";
export type {
  CanvasNodeActions,
  CanvasNodeConnectionSide,
  CanvasNodeContextValue,
  CanvasNodeInteractionState,
  CanvasNodeMeta,
  CanvasNodeProviderProps,
  CanvasNodeRootProps,
  CanvasNodeState,
  CanvasNodeStatus,
  CanvasNodeVisualStatusTone,
} from "./canvas-node.types";

export const CanvasNode = {
  ActionBar: CanvasNodeActionBar,
  ActionButton: CanvasNodeActionButton,
  ActionMenu: CanvasNodeActionMenu,
  ActionMenuItem: CanvasNodeActionMenuItem,
  Body: CanvasNodeBody,
  Card: CanvasNodeCard,
  ConnectionAnchor: CanvasNodeConnectionAnchor,
  CopyableRow: CanvasNodeCopyableRow,
  CopyableRowActions: CanvasNodeCopyableRowActions,
  CopyableRowControl: CanvasNodeCopyableRowControl,
  CopyableRowIndicator: CanvasNodeCopyableRowIndicator,
  CopyableRowValue: CanvasNodeCopyableRowValue,
  CopyFeedbackScope: CanvasNodeCopyFeedbackScope,
  DragFrame: CanvasNodeDragFrame,
  DragStateFrame: CanvasNodeDragStateFrame,
  ExpandButton: CanvasNodeExpandButton,
  Frame: CanvasNodeFrame,
  Footer: CanvasNodeFooter,
  FooterStatus: CanvasNodeFooterStatus,
  Header: CanvasNodeHeader,
  Metric: CanvasNodeMetric,
  MetricList: CanvasNodeMetricList,
  Metrics: CanvasNodeMetrics,
  Placeholder: CanvasNodePlaceholder,
  Root: CanvasNodeRoot,
  Status: CanvasNodeStatus,
  StatusDot: CanvasNodeStatusDot,
  StatusPill: CanvasNodeStatusPill,
  Surface: CanvasNodeSurface,
} as const;

const dn = (component: object, name: string) => {
  (component as { displayName?: string }).displayName = name;
};

dn(CanvasNodeRoot, "CanvasNode.Root");
dn(CanvasNodeActionBar, "CanvasNode.ActionBar");
dn(CanvasNodeActionButton, "CanvasNode.ActionButton");
dn(CanvasNodeActionMenu, "CanvasNode.ActionMenu");
dn(CanvasNodeActionMenuItem, "CanvasNode.ActionMenuItem");
dn(CanvasNodeFrame, "CanvasNode.Frame");
dn(CanvasNodeSurface, "CanvasNode.Surface");
dn(CanvasNodeHeader, "CanvasNode.Header");
dn(CanvasNodeBody, "CanvasNode.Body");
dn(CanvasNodeCard, "CanvasNode.Card");
dn(CanvasNodeFooter, "CanvasNode.Footer");
dn(CanvasNodeFooterStatus, "CanvasNode.FooterStatus");
dn(CanvasNodeMetric, "CanvasNode.Metric");
dn(CanvasNodeMetricList, "CanvasNode.MetricList");
dn(CanvasNodeMetrics, "CanvasNode.Metrics");
dn(CanvasNodePlaceholder, "CanvasNode.Placeholder");
dn(CanvasNodeConnectionAnchor, "CanvasNode.ConnectionAnchor");
dn(CanvasNodeCopyFeedbackScope, "CanvasNode.CopyFeedbackScope");
dn(CanvasNodeCopyableRow, "CanvasNode.CopyableRow");
dn(CanvasNodeCopyableRowActions, "CanvasNode.CopyableRowActions");
dn(CanvasNodeCopyableRowControl, "CanvasNode.CopyableRowControl");
dn(CanvasNodeCopyableRowIndicator, "CanvasNode.CopyableRowIndicator");
dn(CanvasNodeCopyableRowValue, "CanvasNode.CopyableRowValue");
dn(CanvasNodeExpandButton, "CanvasNode.ExpandButton");
dn(CanvasNodeDragFrame, "CanvasNode.DragFrame");
dn(CanvasNodeDragStateFrame, "CanvasNode.DragStateFrame");
dn(CanvasNodeStatus, "CanvasNode.Status");
dn(CanvasNodeStatusDot, "CanvasNode.StatusDot");
dn(CanvasNodeStatusPill, "CanvasNode.StatusPill");
