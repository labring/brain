import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEPLOYMENT_TASK_SUCCESS_SHARE_CHANNELS,
  DeploymentTaskSuccessQrPanel,
  shareHost,
  shareText,
  shareTitle,
} from "./deployment-task-success-share";

const URL_WITH_RESERVED = "https://demo.sealos.run/path?a=1&b=2#top";
const URL_WITH_SPACE = "https://demo.sealos.run/my page?a=1&b=2#top";
const OPEN_ON_PHONE_RE = /Open on your phone/;
const PANEL_HOST_RE = />meetinghub\.sealos\.run</;
const SVG_RE = /<svg/;
const WHITE_TILE_RE = /bg-white/;
const PANEL_TITLE_RE = /title="https:\/\/meetinghub\.sealos\.run\/app"/;

function channel(id: string) {
  const found = DEPLOYMENT_TASK_SUCCESS_SHARE_CHANNELS.find(
    (candidate) => candidate.id === id
  );
  assert.ok(found, `channel ${id} is declared`);
  return found;
}

test("share copy reads as an announcement when the product has a name", () => {
  assert.equal(
    shareText("MeetingHub", "https://meetinghub.sealos.run"),
    "Just launched MeetingHub 🚀 https://meetinghub.sealos.run"
  );
  assert.equal(
    shareTitle("MeetingHub", "https://meetinghub.sealos.run"),
    "Just launched MeetingHub"
  );
});

test("share copy invents nothing when the product has no name", () => {
  assert.equal(
    shareText(undefined, "https://meetinghub.sealos.run"),
    "https://meetinghub.sealos.run"
  );
  assert.equal(
    shareTitle(undefined, "https://meetinghub.sealos.run:8443/x"),
    "meetinghub.sealos.run:8443"
  );
});

test("an unparsable address falls back to the raw address for the title", () => {
  assert.equal(shareTitle(undefined, "not a url"), "not a url");
  assert.equal(shareHost("not a url"), "not a url");
  assert.equal(shareHost("https://demo.sealos.run/path"), "demo.sealos.run");
});

test("the four channels are declared in order with accessible labels", () => {
  assert.deepEqual(
    DEPLOYMENT_TASK_SUCCESS_SHARE_CHANNELS.map((entry) => [
      entry.id,
      entry.label,
    ]),
    [
      ["x", "Post on X"],
      ["linkedin", "Share on LinkedIn"],
      ["facebook", "Share on Facebook"],
      ["reddit", "Post on Reddit"],
    ]
  );
});

test("every channel encodes the address so reserved characters survive", () => {
  const encodedUrl = encodeURIComponent(URL_WITH_RESERVED);
  assert.equal(
    channel("x").href(URL_WITH_RESERVED, "My App"),
    `https://x.com/intent/post?text=${encodeURIComponent(
      `Just launched My App 🚀 ${URL_WITH_RESERVED}`
    )}`
  );
  assert.equal(
    channel("linkedin").href(URL_WITH_RESERVED, "My App"),
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`
  );
  assert.equal(
    channel("facebook").href(URL_WITH_RESERVED, "My App"),
    `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
  );
  assert.equal(
    channel("reddit").href(URL_WITH_RESERVED, "My App"),
    `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(
      "Just launched My App"
    )}`
  );
  // The raw `&`, `#` and space never appear unencoded in a query value,
  // whether they come from the address or from the product name.
  for (const entry of DEPLOYMENT_TASK_SUCCESS_SHARE_CHANNELS) {
    const href = entry.href(URL_WITH_SPACE, "My App");
    assert.equal(href.includes("#"), false, `${entry.id} encodes #`);
    assert.equal(href.includes("&b=2"), false, `${entry.id} encodes &`);
    assert.equal(href.includes(" "), false, `${entry.id} encodes spaces`);
    assert.ok(
      href.includes(encodeURIComponent(URL_WITH_SPACE)),
      `${entry.id} carries the whole address`
    );
  }
});

test("without a product name Reddit titles the submission with the host", () => {
  assert.equal(
    channel("reddit").href("https://demo.sealos.run/x", undefined),
    `https://www.reddit.com/submit?url=${encodeURIComponent(
      "https://demo.sealos.run/x"
    )}&title=demo.sealos.run`
  );
});

test("the QR panel says what a scan opens and shows the host", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskSuccessQrPanel url="https://meetinghub.sealos.run/app" />
  );
  assert.match(html, OPEN_ON_PHONE_RE);
  assert.match(html, PANEL_HOST_RE);
  // The code itself is an SVG, dark on a white tile whatever the theme.
  assert.match(html, SVG_RE);
  assert.match(html, WHITE_TILE_RE);
  assert.match(html, PANEL_TITLE_RE);
});
