/**
 * Snapshot-glass visual equivalence guard.
 *
 * Compares the /glass-equivalence fixture rendered with live
 * `backdrop-filter` against the pre-blurred snapshot texture, window by
 * window (one per canvas node, including one over the bloom center), with
 * BOTH per-region channel-mean assertions and pixelmatch. Channel means are
 * load-bearing: pixelmatch is anti-aliasing-tolerant by design and passes
 * exactly the flat color shifts that color-management bugs produce (a +10
 * RGB veil once measured 0.031% on pixelmatch).
 *
 * Usage:
 *   bun run --cwd apps/registry dev        # or any server for the app
 *   bun run --cwd apps/registry e2e:glass  # GLASS_E2E_URL overrides the URL
 *
 * GLASS_E2E_TRACE=1 additionally records 4s CDP traces (snapshot / live /
 * glass-off, each with paint-damaging ping dots above the glass) and reports
 * cross-process toplevel task time — the idle-cost acceptance evidence.
 * Environment-sensitive, so it reports instead of asserting.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";

const BASE_URL = process.env.GLASS_E2E_URL ?? "http://localhost:10000";
// Per channel, 0..255 scale. The failure modes this guards against sit far
// above it: color-management veils ≥1–2/255, stale/misaligned textures
// ≥5/255. The two-plane split (screen-space ambient + flow-space content,
// required for continuous panning) carries a second-order blur-decomposition
// term measured ≤0.4/255 in the worst window; 0.5 keeps 2–10× margin on the
// real failure modes while accommodating it.
const CHANNEL_MEAN_LIMIT = 0.5;
const PIXELMATCH_RATIO_LIMIT = 0.01; // ≤1% differing pixels per window
const DEVICE_SCALE = 2;
const WINDOW_INSET_PX = 16; // stay inside the rounded mask corners
const TRACE = process.env.GLASS_E2E_TRACE === "1";
const TRACE_MS = 4000;

const artifactsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "artifacts"
);

async function openFixture(page, { mode, pings }) {
  const params = new URLSearchParams();
  if (mode !== "snapshot") {
    params.set("mode", mode);
  }
  if (pings) {
    params.set("pings", "1");
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  await page.goto(`${BASE_URL}/glass-equivalence${query}`, {
    waitUntil: "networkidle",
  });

  const visibility = await page.evaluate(() => document.visibilityState);
  if (visibility !== "visible") {
    throw new Error(
      `fixture page reports visibilityState=${visibility}; snapshot regeneration defers while hidden`
    );
  }

  await page.waitForSelector(".react-flow__edge-path", { state: "attached" });
  await page.waitForSelector(".canvas-glass-sheet", { state: "attached" });
  if (mode === "snapshot") {
    await page.waitForSelector('.canvas-glass-sheet[data-snapshot="ready"]', {
      state: "attached",
    });
  }
  await page.evaluate(() => document.fonts.ready);
  // Let settle-debounced regens (160ms) and paint catch up.
  await page.waitForTimeout(400);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })
  );
}

/** Fixture box + per-node sample windows, in CSS px relative to the box. */
async function readSampleWindows(page) {
  return await page.evaluate((inset) => {
    const fixture = document.querySelector("[data-glass-fixture]");
    if (fixture == null) {
      throw new Error("fixture root not found");
    }
    const box = fixture.getBoundingClientRect();
    const windows = [...document.querySelectorAll(".react-flow__node")]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          height: Math.round(rect.height - inset * 2),
          id: node.getAttribute("data-id") ?? "node",
          left: Math.round(rect.left - box.left + inset),
          top: Math.round(rect.top - box.top + inset),
          width: Math.round(rect.width - inset * 2),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      box: {
        height: Math.round(box.height),
        left: Math.round(box.left),
        top: Math.round(box.top),
        width: Math.round(box.width),
      },
      windows,
    };
  }, WINDOW_INSET_PX);
}

async function screenshotFixture(page, box) {
  const buffer = await page.screenshot({
    animations: "disabled",
    clip: { height: box.height, width: box.width, x: box.left, y: box.top },
    type: "png",
  });
  return PNG.sync.read(buffer);
}

function cropWindow(png, window) {
  const scale = DEVICE_SCALE;
  const out = new PNG({
    height: window.height * scale,
    width: window.width * scale,
  });
  PNG.bitblt(
    png,
    out,
    window.left * scale,
    window.top * scale,
    window.width * scale,
    window.height * scale,
    0,
    0
  );
  return out;
}

function channelMeans(png) {
  const totals = [0, 0, 0];
  const pixels = png.width * png.height;
  for (let index = 0; index < png.data.length; index += 4) {
    totals[0] += png.data[index];
    totals[1] += png.data[index + 1];
    totals[2] += png.data[index + 2];
  }
  return totals.map((total) => total / pixels);
}

function compareWindow(id, snapshotPng, livePng) {
  const meansSnapshot = channelMeans(snapshotPng);
  const meansLive = channelMeans(livePng);
  const meanDeltas = meansSnapshot.map((mean, channel) =>
    Math.abs(mean - meansLive[channel])
  );
  const diff = new PNG({
    height: snapshotPng.height,
    width: snapshotPng.width,
  });
  const differing = pixelmatch(
    snapshotPng.data,
    livePng.data,
    diff.data,
    snapshotPng.width,
    snapshotPng.height,
    { threshold: 0.1 }
  );
  const differingRatio = differing / (snapshotPng.width * snapshotPng.height);
  return {
    diff,
    id,
    meanDeltas,
    meanDeltasOk: meanDeltas.every((delta) => delta <= CHANNEL_MEAN_LIMIT),
    differingRatio,
    pixelmatchOk: differingRatio <= PIXELMATCH_RATIO_LIMIT,
  };
}

async function captureMode(browser, mode) {
  const context = await browser.newContext({
    colorScheme: "dark",
    deviceScaleFactor: DEVICE_SCALE,
    viewport: { height: 900, width: 1280 },
  });
  const page = await context.newPage();
  await openFixture(page, { mode, pings: false });
  const { box, windows } = await readSampleWindows(page);
  const png = await screenshotFixture(page, box);
  await context.close();
  return { png, windows };
}

/** Sum toplevel task durations per second across every process in a trace. */
function crossProcessTaskMsPerSecond(traceBuffer, durationMs) {
  const trace = JSON.parse(traceBuffer.toString("utf8"));
  const events = Array.isArray(trace) ? trace : trace.traceEvents;
  let totalMicroseconds = 0;
  for (const event of events) {
    if (
      event.ph === "X" &&
      typeof event.dur === "number" &&
      typeof event.cat === "string" &&
      event.cat.split(",").includes("toplevel")
    ) {
      totalMicroseconds += event.dur;
    }
  }
  return totalMicroseconds / 1000 / (durationMs / 1000);
}

/**
 * Idle-cost traces need a HEADED browser: headless produces frames on
 * demand rather than per vsync, so the per-frame backdrop-filter tax never
 * runs and all modes measure alike. This opens a visible window briefly.
 */
async function traceMode(mode) {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  try {
    const context = await browser.newContext({
      colorScheme: "dark",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    await openFixture(page, { mode, pings: true });
    await browser.startTracing(page, {
      categories: ["toplevel"],
    });
    await page.waitForTimeout(TRACE_MS);
    const buffer = await browser.stopTracing();
    await context.close();
    return crossProcessTaskMsPerSecond(buffer, TRACE_MS);
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(artifactsDirectory, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const snapshot = await captureMode(browser, "snapshot");
    const live = await captureMode(browser, "live");

    const windowIds = snapshot.windows.map((window) => window.id).join(",");
    const liveIds = live.windows.map((window) => window.id).join(",");
    if (windowIds !== liveIds) {
      throw new Error(
        `window sets differ between modes: [${windowIds}] vs [${liveIds}]`
      );
    }

    await writeFile(
      path.join(artifactsDirectory, "snapshot.png"),
      PNG.sync.write(snapshot.png)
    );
    await writeFile(
      path.join(artifactsDirectory, "live.png"),
      PNG.sync.write(live.png)
    );

    let failed = false;
    const report = [];
    for (const [index, window] of snapshot.windows.entries()) {
      const liveWindow = live.windows[index];
      const result = compareWindow(
        window.id,
        cropWindow(snapshot.png, window),
        cropWindow(live.png, liveWindow)
      );
      await writeFile(
        path.join(artifactsDirectory, `diff-${window.id}.png`),
        PNG.sync.write(result.diff)
      );
      const ok = result.meanDeltasOk && result.pixelmatchOk;
      failed ||= !ok;
      report.push({
        differingRatio: result.differingRatio,
        id: window.id,
        meanDeltas: result.meanDeltas,
        ok,
      });
      const deltas = result.meanDeltas
        .map((delta) => delta.toFixed(3))
        .join("/");
      console.log(
        `${ok ? "PASS" : "FAIL"} ${window.id}: channel-mean Δ ${deltas} (limit ${CHANNEL_MEAN_LIMIT}), pixelmatch ${(result.differingRatio * 100).toFixed(3)}% (limit ${PIXELMATCH_RATIO_LIMIT * 100}%)`
      );
    }

    let trace = null;
    if (TRACE) {
      const repeats = Number.parseInt(process.env.GLASS_E2E_REPEATS ?? "3", 10);
      const samples = { live: [], off: [], snapshot: [] };
      // Interleave modes so machine-load drift cancels across them.
      for (let round = 0; round < repeats; round += 1) {
        samples.live.push(await traceMode("live"));
        samples.snapshot.push(await traceMode("snapshot"));
        samples.off.push(await traceMode("off"));
      }
      const median = (values) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      };
      trace = {
        liveMsPerS: median(samples.live),
        offMsPerS: median(samples.off),
        samples,
        snapshotMsPerS: median(samples.snapshot),
      };
      console.log(
        `idle cost (toplevel task ms/s, median of ${repeats}×${TRACE_MS / 1000}s, pings on): ` +
          `live ${trace.liveMsPerS.toFixed(1)} | snapshot ${trace.snapshotMsPerS.toFixed(1)} | glass-off ${trace.offMsPerS.toFixed(1)}`
      );
    }

    await writeFile(
      path.join(artifactsDirectory, "report.json"),
      JSON.stringify({ report, trace }, null, 2)
    );

    if (failed) {
      process.exitCode = 1;
      console.error("glass equivalence FAILED — see e2e/artifacts/");
    } else {
      console.log("glass equivalence passed");
    }
  } finally {
    await browser.close();
  }
}

await main();
