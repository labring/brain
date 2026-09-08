import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEPLOYMENT_TASK_SUCCESS_SHARE_CHANNELS,
  DeploymentTaskSuccessQrPanel,
  redditTitle,
  shareHost,
  shareVoice,
  xPostText,
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

const URL = "https://meetinghub.sealos.run";

test("the generic X post names the product and Sealos in three beats", () => {
  assert.equal(
    xPostText({ productName: "MeetingHub", url: URL }),
    [
      "Just deployed MeetingHub with Sealos. @Sealos_io",
      "From idea to live app.",
      "",
      `Try it here: ${URL}`,
      "",
      "#Sealos #BuildInPublic",
    ].join("\n")
  );
});

test("the X post invents no name and no number when the record has none", () => {
  assert.equal(
    xPostText({ url: URL }),
    [
      "Just deployed with Sealos. @Sealos_io",
      "From idea to live app.",
      "",
      `Try it here: ${URL}`,
      "",
      "#Sealos #BuildInPublic",
    ].join("\n")
  );
  assert.equal(
    xPostText({ productCategories: ["ai"], url: URL }).split("\n")[0],
    "I just took an idea to a live app with Sealos. @Sealos_io"
  );
  assert.equal(xPostText({ url: URL }).includes("minute"), false);
});

test("the voice follows the hard-coded product first, then the first category", () => {
  assert.equal(shareVoice({}), "generic");
  assert.equal(shareVoice({ productCategories: ["game", "ai"] }), "game");
  assert.equal(shareVoice({ productCategories: ["ai", "game"] }), "ai");
  assert.equal(shareVoice({ productCategories: [" Game "] }), "game");
  assert.equal(shareVoice({ productCategories: ["tool"] }), "generic");
  assert.equal(
    shareVoice({ productCategories: ["ai"], productId: "eaglercraft-server" }),
    "eaglercraft"
  );
  assert.equal(shareVoice({ productId: "EaglerCraft-Server" }), "eaglercraft");
  assert.equal(shareVoice({ productId: "minecraft" }), "generic");
});

test("a game server and the EaglerCraft server invite people to join", () => {
  assert.equal(
    xPostText({
      productCategories: ["game"],
      productName: "Minecraft",
      url: URL,
    }),
    [
      "My own game server is live! @Sealos_io",
      "Deployed with Sealos.",
      "",
      `Join here: ${URL}`,
      "",
      "#Sealos",
    ].join("\n")
  );
  assert.equal(
    xPostText({
      productCategories: ["game"],
      productId: "eaglercraft-server",
      productName: "EaglerCraft Server",
      url: URL,
    }),
    [
      "My own Eaglercraft server is live! @Sealos_io",
      "Deployed with Sealos.",
      "",
      `Join here: ${URL}`,
      "",
      "#Eaglercraft #Minecraft #Sealos",
    ].join("\n")
  );
});

test("an AI app takes the idea-to-live-app voice", () => {
  assert.equal(
    xPostText({ productCategories: ["ai"], productName: "FastGPT", url: URL }),
    [
      "I just took FastGPT from idea to live app with Sealos. @Sealos_io",
      "No complicated setup. Just deploy, share, and start building.",
      "",
      `Try it here: ${URL}`,
      "",
      "#AI #BuildInPublic #Sealos",
    ].join("\n")
  );
});

test("the Reddit title names the product when it can", () => {
  assert.equal(
    redditTitle("MeetingHub"),
    "MeetingHub is live — just shipped with Sealos"
  );
  assert.equal(
    redditTitle(undefined),
    "My app is live — just shipped with Sealos"
  );
});

test("the host falls back to the raw address when it cannot be parsed", () => {
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
  const subject = { productName: "My App", url: URL_WITH_RESERVED };
  assert.equal(
    channel("x").href(subject),
    `https://x.com/intent/post?text=${encodeURIComponent(xPostText(subject))}`
  );
  // Line breaks reach X as %0A, and the blank lines between the beats as a
  // doubled one, so the post keeps its shape.
  assert.ok(channel("x").href(subject).includes("%0A%0A"));
  assert.equal(
    channel("linkedin").href(subject),
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`
  );
  assert.equal(
    channel("facebook").href(subject),
    `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
  );
  assert.equal(
    channel("reddit").href(subject),
    `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(
      "My App is live — just shipped with Sealos"
    )}`
  );
  // The raw `&`, `#` and space never appear unencoded in a query value,
  // whether they come from the address or from the product name.
  for (const entry of DEPLOYMENT_TASK_SUCCESS_SHARE_CHANNELS) {
    const href = entry.href({ productName: "My App", url: URL_WITH_SPACE });
    assert.equal(href.includes("#"), false, `${entry.id} encodes #`);
    assert.equal(href.includes("&b=2"), false, `${entry.id} encodes &`);
    assert.equal(href.includes(" "), false, `${entry.id} encodes spaces`);
    assert.ok(
      href.includes(encodeURIComponent(URL_WITH_SPACE)),
      `${entry.id} carries the whole address`
    );
  }
});

test("without a product name Reddit still gets a title", () => {
  assert.equal(
    channel("reddit").href({ url: "https://demo.sealos.run/x" }),
    `https://www.reddit.com/submit?url=${encodeURIComponent(
      "https://demo.sealos.run/x"
    )}&title=${encodeURIComponent("My app is live — just shipped with Sealos")}`
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
