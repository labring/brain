import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ContainerNodeContent } from "./container-node.content";
import { ContainerNodeRoot } from "./container-node.root";

const CONTAINER_SUBTITLE_RE = />Container</;
const AP_WORKLOAD_SUBTITLE_RE = /AP workload/;
const OPEN_WORKLOAD_ACTIONS_RE = /Open workload actions/;
const WORKLOAD_NOT_RUNNING_RE = /Workload is not running\./;

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
