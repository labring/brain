import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ContainerNodeContent } from "./container-node.content";
import { ContainerNodeRoot } from "./container-node.root";

const CONTAINER_SUBTITLE_RE = />Container</;
const AP_WORKLOAD_SUBTITLE_RE = /AP workload/;

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
