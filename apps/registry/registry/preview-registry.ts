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
  "linear/components/ai-elements": {
    style: "linear",
    group: "components",
    name: "ai-elements",
    title: "AI Elements",
    description:
      "Chat primitives used by the project assistant: message bubbles, the conversation scroll region, loading shimmer, and collapsible tool/task cards.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "button", "collapsible", "spinner"],
    files: [
      {
        path: "registry/linear/components/ai-elements/ai-elements-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/ai-elements/message.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/ai-elements/conversation.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/ai-elements/shimmer.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/ai-elements/task.tsx",
        type: "registry:ui",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/ai-elements/ai-elements-preview"),
  },

  "linear/components/app-icon-button": {
    style: "linear",
    group: "components",
    name: "app-icon-button",
    title: "App Icon Button",
    description:
      "SealAI product icon-only button with shared size and variant semantics. Use this instead of the shared primitive Button for icon-only product actions.",
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
      "SealAI product button for non-icon actions. Use this instead of the shared primitive Button in product surfaces.",
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
      "SealAI product single-line input for panes and settings forms. Use this instead of the shared primitive Input in product surfaces.",
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

  "linear/components/app-select": {
    style: "linear",
    group: "components",
    name: "app-select",
    title: "App Select",
    description:
      "SealAI product single and multi-select controls for forms, filters, and settings surfaces.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "app-select"],
    files: [
      {
        path: "registry/linear/components/app-select/app-select-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/app-select.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/lib/popover-surface.ts",
        type: "registry:lib",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/app-select/app-select-preview"),
  },

  "linear/components/app-textarea": {
    style: "linear",
    group: "components",
    name: "app-textarea",
    title: "App Textarea",
    description:
      "SealAI product multi-line input for forms and source editors. Use this instead of the shared primitive Textarea in product surfaces.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "app-textarea", "textarea"],
    files: [
      {
        path: "registry/linear/components/app-textarea/app-textarea-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/app-textarea.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/textarea.tsx",
        type: "registry:ui",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/app-textarea/app-textarea-preview"),
  },

  "linear/components/app-input-field": {
    style: "linear",
    group: "components",
    name: "app-input-field",
    title: "App Input Field",
    description:
      "SealAI product text input field with label, description, error, and accessibility wiring.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "app-input-field", "app-input", "field"],
    files: [
      {
        path: "registry/linear/components/app-input-field/app-input-field-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/app-input-field.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/app-input.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/field.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/input.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/label.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/separator.tsx",
        type: "registry:ui",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import(
        "@registry/linear/components/app-input-field/app-input-field-preview"
      ),
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
    registryDependencies: ["preview", "app-dialog", "app-button"],
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

  "linear/components/toaster": {
    style: "linear",
    group: "components",
    name: "toaster",
    title: "Toaster",
    description:
      "Global toast presentation for transient product feedback: status icons, copy wrapping, async states, and dismissal.",
    state: "coding",
    type: "registry:preview",
    registryDependencies: ["preview", "app-button"],
    files: [
      {
        path: "registry/linear/components/toaster/toaster-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/sonner.tsx",
        type: "registry:ui",
        target: "",
      },
      previewUiFile,
    ],
    load: () => import("@registry/linear/components/toaster/toaster-preview"),
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

  "linear/components/canvas-node": {
    style: "linear",
    group: "components",
    name: "canvas-node",
    title: "Canvas Node",
    description:
      "Shared canvas node primitives, including placeholder chrome for temporary skeleton nodes.",
    state: "done",
    type: "registry:preview",
    registryDependencies: ["preview", "canvas-node"],
    files: [
      {
        path: "registry/linear/components/canvas-node/canvas-node-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import("@registry/linear/components/canvas-node/canvas-node-preview"),
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

  "linear/components/sliding-toggle": {
    style: "linear",
    group: "components",
    name: "sliding-toggle",
    title: "Sliding toggle",
    description:
      "Segmented toggle with a sliding input-colored indicator, default and compact sizing, and full-width or content-width layout.",
    state: "done",
    type: "registry:preview",
    registryDependencies: ["preview", "sliding-toggle", "toggle-group"],
    files: [
      {
        path: "registry/linear/components/sliding-toggle/sliding-toggle-preview.tsx",
        type: "registry:preview",
        target: "",
      },
      {
        path: "packages/ui/src/components/sliding-toggle.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/toggle-group.tsx",
        type: "registry:ui",
        target: "",
      },
      {
        path: "packages/ui/src/components/toggle.tsx",
        type: "registry:ui",
        target: "",
      },
      previewUiFile,
    ],
    load: () =>
      import(
        "@registry/linear/components/sliding-toggle/sliding-toggle-preview"
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
};
