import assert from "node:assert/strict";
import { test } from "node:test";
import { CanvasNodeCopyFeedbackScope } from "@workspace/ui/components/canvas-node/canvas-node.copyable-row";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ContainerNodeContent,
  ContainerNodeImageRow,
} from "./container-node.content";
import { ContainerNodeProvider } from "./container-node.provider";
import { ContainerNodeRoot } from "./container-node.root";

const CONTAINER_SUBTITLE_RE = />Container</;
const AP_WORKLOAD_SUBTITLE_RE = /AP workload/;
const OPEN_WORKLOAD_ACTIONS_RE = /Open workload actions/;
const WORKLOAD_NOT_RUNNING_RE = /Workload is not running\./;
const COPY_BUTTON_SLOT_RE = /data-slot="canvas-node-row-copy-button"/;
const COPY_IMAGE_RE = /aria-label="Copy Image"/;
const COPIED_IMAGE_RE = /aria-label="Copied Image"/;
const NATIVE_IMAGE_TOOLTIP_RE = /title="nginx:latest"/;
const TOOLTIP_TRIGGER_RE = /data-slot="tooltip-trigger"/;

function renderImageRow(copiedKey?: string): string {
  return renderToStaticMarkup(
    <CanvasNodeCopyFeedbackScope copiedKey={copiedKey}>
      <ContainerNodeProvider
        value={{
          actions: {},
          state: {
            states: {
              image: "nginx:latest",
              name: "api",
            },
          },
        }}
      >
        <ContainerNodeImageRow />
      </ContainerNodeProvider>
    </CanvasNodeCopyFeedbackScope>
  );
}

test("ContainerNode image row uses the shared explicit copy action", () => {
  const html = renderImageRow();

  assert.match(html, COPY_BUTTON_SLOT_RE);
  assert.match(html, COPY_IMAGE_RE);
  assert.match(html, TOOLTIP_TRIGGER_RE);
  assert.doesNotMatch(html, NATIVE_IMAGE_TOOLTIP_RE);
});

test("ContainerNode image row pins copied feedback on the copy button", () => {
  const html = renderImageRow("image");

  assert.match(html, COPIED_IMAGE_RE);
});

test("ContainerNodeContent labels AP cards as Container", () => {
  const html = renderToStaticMarkup(
    <ContainerNodeRoot
      states={{
        image: "nginx:latest",
        kind: "AP",
        name: "api",
      }}
    >
      <ContainerNodeContent />
    </ContainerNodeRoot>
  );

  assert.match(html, CONTAINER_SUBTITLE_RE);
  assert.doesNotMatch(html, AP_WORKLOAD_SUBTITLE_RE);
});

test("ContainerNodeContent omits lifecycle menu without a family", () => {
  const html = renderToStaticMarkup(
    <ContainerNodeRoot
      states={{
        image: "nginx:latest",
        kind: "AP",
        name: "api",
        status: { label: "Running", tone: "running" },
      }}
    >
      <ContainerNodeContent />
    </ContainerNodeRoot>
  );

  assert.doesNotMatch(html, OPEN_WORKLOAD_ACTIONS_RE);
});

test("ContainerNodeContent keeps disabled lifecycle family discoverable", () => {
  const html = renderToStaticMarkup(
    <ContainerNodeRoot
      lifecycleActions={{
        delete: {
          disabled: true,
          disabledReason: "This project is read-only.",
        },
        restart: {
          disabled: true,
          disabledReason: "This project is read-only.",
        },
        stop: {
          disabled: true,
          disabledReason: "This project is read-only.",
        },
      }}
      states={{
        image: "nginx:latest",
        kind: "AP",
        name: "api",
        status: { label: "Running", tone: "running" },
      }}
    >
      <ContainerNodeContent />
    </ContainerNodeRoot>
  );

  assert.match(html, OPEN_WORKLOAD_ACTIONS_RE);
});

test("ContainerNodeContent gates the terminal quick action while stopped", () => {
  const html = renderToStaticMarkup(
    <ContainerNodeRoot
      quickActions={{
        terminal: { onClick: () => undefined },
      }}
      states={{
        image: "nginx:latest",
        kind: "AP",
        name: "api",
        status: { label: "Stopped", tone: "stopped" },
      }}
    >
      <ContainerNodeContent />
    </ContainerNodeRoot>
  );

  assert.match(html, WORKLOAD_NOT_RUNNING_RE);
});
