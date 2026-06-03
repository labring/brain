import type { ComponentType } from "react";

import type { RegistryPreviewState } from "./nav-types";

export interface RegistryFile {
  path: string;
  target: string;
  type: string;
}

export type RegistryPreviewLoader = () => Promise<{ default: ComponentType }>;

/** One implementation of a preview (e.g. `v0` / `v1` folders). */
export interface RegistryPreviewVariant {
  id: string;
  load: RegistryPreviewLoader;
  title: string;
}

/**
 * One preview entry. Register new previews only here: metadata + `load` or `variants`.
 * Object key must equal `\`${style}/${group}/${name}\`` (same as URL under `/registry/`).
 */
export interface RegistryPreviewItem {
  description: string;
  files: RegistryFile[];
  group: string;
  /** Single implementation (most entries). */
  load?: RegistryPreviewLoader;
  name: string;
  registryDependencies: string[];
  state: RegistryPreviewState;
  style: string;
  title: string;
  type: "registry:preview";
  /**
   * Multiple implementations; workspace shows a variant menu when length > 1.
   * Order oldest → newest; the **last** entry is the default selection.
   */
  variants?: RegistryPreviewVariant[];
}

export type RegistryIndex = Record<string, RegistryPreviewItem>;

const previewUiFile: RegistryFile = {
  path: "packages/ui/src/components/preview.tsx",
  target: "",
  type: "registry:ui",
};

function getPreviewVariantsForItem(
  item: RegistryPreviewItem
): RegistryPreviewVariant[] {
  if (item.variants && item.variants.length > 0) {
    return item.variants;
  }
  if (item.load) {
    return [{ id: "default", load: item.load, title: "Default" }];
  }
  throw new Error(
    `Registry preview ${item.style}/${item.group}/${item.name} has neither load nor variants`
  );
}

function getRegistryPreviewVariantsForKey(
  key: string
): RegistryPreviewVariant[] {
  const item = Index[key];
  if (!item) {
    return [];
  }
  return getPreviewVariantsForItem(item);
}

/** Labels for the variant switcher (no loaders). */
export function getRegistryPreviewVariantOptions(
  key: string
): { id: string; title: string }[] {
  return getRegistryPreviewVariantsForKey(key).map(({ id, title }) => ({
    id,
    title,
  }));
}

export function getRegistryPreviewLoaderByKey(
  key: string,
  variantId?: string | null
): RegistryPreviewLoader | undefined {
  const item = Index[key];
  if (!item) {
    return undefined;
  }
  const variants = getPreviewVariantsForItem(item);
  const newest = variants.at(-1);
  if (!newest) {
    return undefined;
  }
  const newestId = newest.id;
  const resolved =
    variantId && variants.some((v) => v.id === variantId)
      ? variantId
      : newestId;
  return variants.find((v) => v.id === resolved)?.load;
}

export const Index: RegistryIndex = {
  "linear/components/app-icon-button": {
    style: "linear",
    group: "components",
    name: "app-icon-button",
    title: "App Icon Button",
    description:
      "SealAI product icon-only button style layer with shared size and variant semantics.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "app-icon-button", "button"],
    files: [
      {
        path: "registry/linear/components/app-icon-button/app-icon-button-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/app-icon-button.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/button.tsx",
        type: "registry:ui",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import(
        "@registry/linear/components/app-icon-button/app-icon-button-preview"
      ),
  },

  "linear/components/app-button": {
    style: "linear",
    group: "components",
    name: "app-button",
    title: "App Button",
    description:
      "SealAI product button style layer for non-icon actions, built on the shared primitive Button.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "app-button", "button"],
    files: [
      {
        path: "registry/linear/components/app-button/app-button-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/app-button.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/button.tsx",
        type: "registry:ui",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/app-button/app-button-preview"),
  },

  "linear/components/app-input": {
    style: "linear",
    group: "components",
    name: "app-input",
    title: "App Input",
    description:
      "SealAI product input style layer for pane and settings forms, built on the shared primitive Input.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "app-input", "input"],
    files: [
      {
        path: "registry/linear/components/app-input/app-input-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/app-input.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/input.tsx",
        type: "registry:ui",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/app-input/app-input-preview"),
  },

  "linear/components/app-dialog": {
    style: "linear",
    group: "components",
    name: "app-dialog",
    title: "App Dialog",
    description:
      "Dark product dialog compound component for confirmations, forms, and loading actions.",
    state: "done",
    type: "registry:preview",
    registryDependencies: ["preview", "app-dialog", "button"],
    files: [
      {
        path: "registry/linear/components/app-dialog/app-dialog-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/app-dialog.tsx",
        type: "registry:ui",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/app-dialog/app-dialog-preview"),
  },

  "linear/components/log-viewer": {
    style: "linear",
    group: "components",
    name: "log-viewer",
    title: "Log Viewer",
    description: "Virtualized log list with filters, time range, and chart",
    state: "done",
    type: "registry:preview",
    registryDependencies: [
      "button",
      "badge",
      "calendar",
      "chart",
      "command",
      "preview",
      "input-group",
      "popover",
      "tooltip",
    ],
    files: [
      {
        path: "registry/linear/components/log-viewer/log-viewer-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "registry/linear/components/log-viewer/log-viewer-mock.ts",
        target: "",
        type: "registry:preview",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/log-viewer/log-viewer-preview"),
  },

  "linear/components/container-node": {
    style: "linear",
    group: "components",
    name: "container-node",
    title: "Container Node",
    description:
      "Current AP workload canvas node composed with shared Canvas Node chrome, Root/Content state, lifecycle actions, quick actions, footer metrics, and expansion behavior.",
    state: "done",
    type: "registry:preview",
    registryDependencies: [
      "preview",
      "canvas",
      "canvas-node",
      "container-node",
      "app-dialog",
      "button",
      "dropdown-menu",
    ],
    files: [
      {
        path: "registry/linear/components/container-node/container-node-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "registry/linear/components/container-node/container-node-preview.canvas.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import(
        "@registry/linear/components/container-node/container-node-preview"
      ),
  },

  "linear/components/container-settings-pane": {
    style: "linear",
    group: "components",
    name: "container-settings-pane",
    title: "Container settings pane",
    description:
      "Fully controlled: `image`, `env`, `network`, and CPU/Memory quota (`value` + `onValueChange`). AP network settings manage private target ports and public addresses.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: [
      "preview",
      "settings-slider",
      "button",
      "textarea",
      "field",
      "dropdown-menu",
      "app-dialog",
      "label",
      "input",
    ],
    files: [
      {
        path: "registry/linear/components/container-settings-pane/container-settings-pane-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/container-settings-pane/container-settings-pane.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/lib/port-number.ts",
        target: "",
        type: "registry:lib",
      },
      {
        path: "packages/ui/src/components/app-dialog.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/label.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/textarea.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/button.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/settings-slider/settings-slider.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/field.tsx",
        target: "",
        type: "registry:ui",
      },
      previewUiFile,
    ],
    load: () =>
      import(
        "@registry/linear/components/container-settings-pane/container-settings-pane-preview"
      ),
  },

  "linear/components/chat": {
    style: "linear",
    group: "components",
    name: "chat",
    title: "Chat",
    description:
      "Chat workspace: optional Chat.Root shell; compose Header, Transcript, and Composer pieces with explicit props; AI SDK message list",
    state: "done",
    type: "registry:preview",
    registryDependencies: [
      "preview",
      "button",
      "breadcrumb",
      "dropdown-menu",
      "textarea",
      "spinner",
    ],
    files: [
      {
        path: "registry/linear/components/chat/chat-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () => import("@registry/linear/components/chat/chat-preview"),
  },

  "linear/components/github-deployer": {
    style: "linear",
    group: "components",
    name: "github-deployer",
    title: "GitHub deployer",
    description:
      "OAuth auth control (same UX as app sidebar) + repo Select; Root states/actions align with useGithubAuth",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "button", "select", "tooltip"],
    files: [
      {
        path: "registry/linear/components/github-deployer/github-deployer-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import(
        "@registry/linear/components/github-deployer/github-deployer-preview"
      ),
  },

  "linear/components/entry-node": {
    style: "linear",
    group: "components",
    name: "entry-node",
    title: "Entry Node",
    description:
      "Entry point node with hero canvas view and state matrix (access-domain header, target rows).",
    state: "done",
    type: "registry:preview",
    registryDependencies: ["preview", "canvas", "entry-node"],
    files: [
      {
        path: "registry/linear/components/entry-node/entry-node-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "registry/linear/components/entry-node/entry-node-preview.canvas.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/entry-node/entry-node-preview"),
  },

  "linear/components/database-node": {
    style: "linear",
    group: "components",
    name: "database-node",
    title: "Database Node",
    description:
      "Managed database node with hero canvas view and state matrix (connection controls, quick actions, footer metrics).",
    state: "done",
    type: "registry:preview",
    registryDependencies: [
      "preview",
      "canvas",
      "database-node",
      "app-dialog",
      "button",
      "dropdown-menu",
      "switch",
    ],
    files: [
      {
        path: "registry/linear/components/database-node/database-node-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "registry/linear/components/database-node/database-node-preview.canvas.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/database-node/database-node-preview"),
  },

  "linear/components/environment-node": {
    style: "linear",
    group: "components",
    name: "environment-node",
    title: "Environment Node",
    description:
      "Development environment node with hero canvas view and state matrix (launch command, lifecycle actions, quick actions, footer metrics).",
    state: "done",
    type: "registry:preview",
    registryDependencies: [
      "preview",
      "canvas",
      "environment-node",
      "button",
      "dropdown-menu",
    ],
    files: [
      {
        path: "registry/linear/components/environment-node/environment-node-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "registry/linear/components/environment-node/environment-node-preview.canvas.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import(
        "@registry/linear/components/environment-node/environment-node-preview"
      ),
  },

  "linear/components/mdx": {
    style: "linear",
    group: "components",
    name: "mdx",
    title: "MDX / Markdown",
    description:
      "MessageResponse + shared markdownComponents (Streamdown): typography, lists, tables, Shiki-backed code blocks",
    state: "done",
    type: "registry:preview",
    registryDependencies: ["preview"],
    files: [
      {
        path: "registry/linear/components/mdx/mdx-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () => import("@registry/linear/components/mdx/mdx-preview"),
  },

  "linear/components/project-explorer": {
    style: "linear",
    group: "components",
    name: "project-explorer",
    title: "Project Explorer",
    description:
      "Composable project list: header (brand, search, new project), rows with row menu (rename / delete). Default preset is Variant1.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: [
      "preview",
      "button",
      "app-dialog",
      "dropdown-menu",
      "input",
      "label",
    ],
    files: [
      {
        path: "registry/linear/components/project-explorer/project-explorer-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import(
        "@registry/linear/components/project-explorer/project-explorer-preview"
      ),
  },

  "linear/components/project-creator": {
    style: "linear",
    group: "components",
    name: "project-creator",
    title: "Project creator",
    description:
      "Breadcrumb new-project flow: Github, Docker image, or Database; compound Root + Trail / Stage / Variant1",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "button", "input", "label", "breadcrumb"],
    files: [
      {
        path: "registry/linear/components/project-creator/project-creator-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
      {
        path: "packages/ui/src/components/project-creator/project-creator.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/project-creator/project-creator.types.ts",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/project-creator/project-creator.context.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/project-creator/project-creator.layout.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/project-creator/project-creator.trail.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/project-creator/project-creator.pick.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/project-creator/project-creator.stage.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/project-creator/project-creator.variant1.tsx",
        target: "",
        type: "registry:ui",
      },
    ],
    load: () =>
      import(
        "@registry/linear/components/project-creator/project-creator-preview"
      ),
  },

  "linear/components/settings-slider": {
    style: "linear",
    group: "components",
    name: "settings-slider",
    title: "Settings slider",
    description:
      "Settings field slider with animated value, bounds, and compound parts for custom headers.",
    state: "done",
    type: "registry:preview",
    registryDependencies: ["preview"],
    files: [
      {
        path: "registry/linear/components/settings-slider/settings-slider-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import(
        "@registry/linear/components/settings-slider/settings-slider-preview"
      ),
  },

  "linear/components/canvas": {
    style: "linear",
    group: "components",
    name: "canvas",
    title: "Canvas",
    description:
      "React Flow workspace (dots, glow), Jotai context, and node selection state for host-rendered detail panes.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "canvas", "container-node"],
    files: [
      {
        path: "registry/linear/components/canvas/canvas-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.types.ts",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.context.ts",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.use.ts",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.provider.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.error-fallback.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.css",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.edge-anchors.ts",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.node-merge.ts",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.upper-right.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/canvas/canvas.viewport-follow.ts",
        target: "",
        type: "registry:ui",
      },
      previewUiFile,
    ],
    load: () => import("@registry/linear/components/canvas/canvas-preview"),
  },

  "linear/components/container-history-pane": {
    style: "linear",
    group: "components",
    name: "container-history-pane",
    title: "Container history pane",
    description:
      "AP backup list (managed `{name}-config-backup` + orphans `{name}-config-snapshot-{hash}`); Review opens dialog with embedded `config.yaml`; optional cluster fetch via `onLoadConfigYaml`; Rollback for canvas wiring.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: [
      "preview",
      "button",
      "badge",
      "alert",
      "app-dialog",
      "scroll-area",
      "spinner",
    ],
    files: [
      {
        path: "registry/linear/components/container-history-pane/container-history-pane-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "registry/linear/components/container-history-pane/container-history-mock.ts",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/container-history-pane/container-history-pane.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/container-history-pane/container-history-pane.types.ts",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/alert.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/badge.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/button.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/app-dialog.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/spinner.tsx",
        target: "",
        type: "registry:ui",
      },
      {
        path: "packages/ui/src/components/scroll-area.tsx",
        target: "",
        type: "registry:ui",
      },
      previewUiFile,
    ],
    load: () =>
      import(
        "@registry/linear/components/container-history-pane/container-history-pane-preview"
      ),
  },

  "linear/components/metrics-chart": {
    style: "linear",
    group: "components",
    name: "metrics-chart",
    title: "Metrics chart",
    description:
      "Multi-series metrics area chart: MetricsChart.Root + Area compound API, MetricsChartProvider, useMetricsChart; Variant0 / Variant1",
    state: "done",
    type: "registry:preview",
    registryDependencies: ["preview", "chart"],
    files: [
      {
        path: "registry/linear/components/metrics-chart/metrics-chart-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/metrics-chart/metrics-chart-preview"),
  },

  "linear/components/agui": {
    style: "linear",
    group: "components",
    name: "agui",
    title: "AGUI",
    description:
      "json-render MetricsChart: catalog + registry from @workspace/ui, dummy spec for local preview",
    state: "done",
    type: "registry:preview",
    registryDependencies: ["preview", "chart"],
    files: [
      {
        path: "registry/linear/components/agui/agui-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () => import("@registry/linear/components/agui/agui-preview"),
  },

  "shadcn/components/accordion": {
    style: "shadcn",
    group: "components",
    name: "accordion",
    title: "Accordion",
    description: "Collapsible sections for FAQs and structured content",
    state: "designing",
    type: "registry:preview",
    registryDependencies: ["preview", "accordion", "button", "card"],
    files: [
      {
        path: "registry/shadcn/components/accordion-example.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () => import("@registry/shadcn/components/accordion-example"),
  },
  "shadcn/components/alert-dialog": {
    style: "shadcn",
    group: "components",
    name: "alert-dialog",
    title: "Alert Dialog",
    description: "Modal confirmations and destructive actions",
    state: "reviewing",
    type: "registry:preview",
    registryDependencies: ["preview", "alert-dialog", "button", "dialog"],
    files: [
      {
        path: "registry/shadcn/components/alert-dialog-example/v0/alert-dialog-example-v0.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "registry/shadcn/components/alert-dialog-example/v1/alert-dialog-example-v1.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    variants: [
      {
        id: "v0",
        load: () =>
          import(
            "@registry/shadcn/components/alert-dialog-example/v0/alert-dialog-example-v0"
          ),
        title: "v0",
      },
      {
        id: "v1",
        load: () =>
          import(
            "@registry/shadcn/components/alert-dialog-example/v1/alert-dialog-example-v1"
          ),
        title: "v1",
      },
    ],
  },
  "shadcn/components/alert": {
    style: "shadcn",
    group: "components",
    name: "alert",
    title: "Alert",
    description: "Status messages with optional icons and actions",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "alert", "badge", "button"],
    files: [
      {
        path: "registry/shadcn/components/alert-example.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () => import("@registry/shadcn/components/alert-example"),
  },
  "shadcn/components/avatar": {
    style: "shadcn",
    group: "components",
    name: "avatar",
    title: "Avatar",
    description: "User images, fallbacks, badges, and stacked groups",
    state: "done",
    type: "registry:preview",
    registryDependencies: ["preview", "avatar", "button", "empty"],
    files: [
      {
        path: "registry/shadcn/components/avatar-example.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () => import("@registry/shadcn/components/avatar-example"),
  },
};
