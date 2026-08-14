#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const GIT_SUFFIX_RE = /\.git$/i;
const LINE_BREAK_RE = /\r?\n/;
const RESULT_MARKER = "BRAIN_GITHUB_DEPLOY_SMOKE_RESULT:";
const TRAILING_SLASH_RE = /\/$/;

function usage() {
  return `Usage:
  bun apps/ui/scripts/github-deploy-smoke.mjs \\
    --project-id <project-id> \\
    --repo <https://github.com/owner/repo> [options]

Options:
  --base-url <url>       Local Brain URL (default: ${DEFAULT_BASE_URL})
  --submit               Create a real deployment task and wait for completion
  --headed               Show the browser window
  --timeout-ms <ms>      Task timeout (default: ${DEFAULT_TIMEOUT_MS})
  --output-dir <path>    Artifact directory (default: output/playwright/github-deploy/<timestamp>)
  --session <name>       Playwright CLI session name
  --help                 Show this help

Without --submit the script only verifies that the GitHub deployment form is
authorized, accepts the repository URL, and enables Deploy. It does not create
a task.`;
}

function argumentValue(argv, index, name) {
  const value = argv[index + 1]?.trim();
  if (value == null || value === "" || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizedGithubUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("--repo must be a valid GitHub repository URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com"
  ) {
    throw new Error("--repo must use https://github.com/owner/repo.");
  }
  const parts = parsed.pathname
    .replace(GIT_SUFFIX_RE, "")
    .split("/")
    .filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("--repo must use https://github.com/owner/repo.");
  }
  parsed.pathname = `/${parts[0]}/${parts[1]}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(TRAILING_SLASH_RE, "");
}

export function normalizedLocalBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("--base-url must be a valid localhost URL.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "::1", "localhost"].includes(hostname)
  ) {
    throw new Error(
      "--base-url must be an http://localhost, http://127.0.0.1, or http://[::1] URL."
    );
  }
  parsed.pathname = parsed.pathname.replace(TRAILING_SLASH_RE, "") || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(TRAILING_SLASH_RE, "");
}

export function parseGithubDeploySmokeArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    headed: false,
    help: false,
    outputDir: "",
    projectId: "",
    repoUrl: "",
    session: "",
    submit: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--base-url":
        options.baseUrl = argumentValue(argv, index, argument);
        index += 1;
        break;
      case "--headed":
        options.headed = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--output-dir":
        options.outputDir = argumentValue(argv, index, argument);
        index += 1;
        break;
      case "--project-id":
        options.projectId = argumentValue(argv, index, argument);
        index += 1;
        break;
      case "--repo":
        options.repoUrl = argumentValue(argv, index, argument);
        index += 1;
        break;
      case "--session":
        options.session = argumentValue(argv, index, argument);
        index += 1;
        break;
      case "--submit":
        options.submit = true;
        break;
      case "--timeout-ms": {
        const raw = argumentValue(argv, index, argument);
        const timeoutMs = Number(raw);
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
          throw new Error("--timeout-ms must be an integer of at least 1000.");
        }
        options.timeoutMs = timeoutMs;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  options.baseUrl = normalizedLocalBaseUrl(options.baseUrl);
  if (!options.help) {
    if (options.projectId === "") {
      throw new Error("--project-id is required.");
    }
    if (options.repoUrl === "") {
      throw new Error("--repo is required.");
    }
    options.repoUrl = normalizedGithubUrl(options.repoUrl);
  }
  return options;
}

function timestampDirectoryName(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function projectDeploymentUrl(options) {
  const url = new URL(
    `/project/${encodeURIComponent(options.projectId)}`,
    `${options.baseUrl}/`
  );
  url.searchParams.set("side", `github-deployment:${options.projectId}`);
  return url.toString();
}

export function buildGithubDeploySmokeFlow(config) {
  return `async page => {
  const config = ${JSON.stringify(config)};
  const marker = ${JSON.stringify(RESULT_MARKER)};
  const terminalStatuses = new Set(["blocked", "cancelled", "completed", "failed"]);
  const network5xx = [];
  let consoleErrorCount = 0;

  const safeUrl = value => {
    try {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "invalid-url";
    }
  };
  const safeError = error => String(error instanceof Error ? error.message : error)
    .replace(/Bearer\\s+[^\\s]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
  const finish = summary => marker + JSON.stringify({
    ...summary,
    consoleErrorCount,
    finishedAt: new Date().toISOString(),
    network5xx: network5xx.slice(0, 20),
  });

  page.on("console", message => {
    if (message.type() === "error") consoleErrorCount += 1;
  });
  page.on("response", response => {
    if (response.status() >= 500) {
      network5xx.push({ status: response.status(), url: safeUrl(response.url()) });
    }
  });

  try {
    const pane = page.locator('[data-slot="github-deployment-pane"]');
    await pane.waitFor({ state: "visible", timeout: 30000 });
    await page
      .locator('[data-slot="github-deployer-auth-loading"]')
      .waitFor({ state: "hidden", timeout: 30000 })
      .catch(() => undefined);

    const connectButton = page.locator('[data-slot="github-deployer-auth-connect"]');
    if (await connectButton.isVisible().catch(() => false)) {
      return finish({
        code: "github_not_authorized",
        mode: config.submit ? "submit" : "inspect",
        ok: false,
        repoUrl: config.repoUrl,
      });
    }

    const urlInput = pane.locator(
      '[data-slot="github-deployer-url-input"] input[type="url"]'
    );
    await urlInput.waitFor({ state: "visible", timeout: 30000 });
    await urlInput.fill(config.repoUrl);

    const deployButton = pane.locator('[data-slot="github-deployer-url-deploy"]');
    await deployButton.waitFor({ state: "visible", timeout: 30000 });
    const enabled = await deployButton.isEnabled();
    if (!enabled) {
      return finish({
        code: "deploy_button_disabled",
        mode: config.submit ? "submit" : "inspect",
        ok: false,
        repoUrl: config.repoUrl,
      });
    }

    if (!config.submit) {
      return finish({
        code: "form_ready",
        mode: "inspect",
        ok: true,
        repoUrl: config.repoUrl,
      });
    }

    const createResponsePromise = page.waitForResponse(
      response => {
        const url = new URL(response.url());
        return response.request().method() === "POST" && url.pathname === "/api/deploy-tasks";
      },
      { timeout: 60000 }
    );
    await deployButton.click();
    const createResponse = await createResponsePromise;
    const createBody = await createResponse.json().catch(() => null);
    if (!createResponse.ok()) {
      return finish({
        code: "task_create_failed",
        createHttpStatus: createResponse.status(),
        mode: "submit",
        ok: false,
        repoUrl: config.repoUrl,
      });
    }

    const taskId = createBody?.task?.id;
    const projectId = createBody?.task?.projectId;
    if (typeof taskId !== "string" || taskId === "") {
      return finish({
        code: "task_id_missing",
        createHttpStatus: createResponse.status(),
        mode: "submit",
        ok: false,
        repoUrl: config.repoUrl,
      });
    }

    const timelinePageUrl = new URL(page.url());
    timelinePageUrl.pathname = "/project/" + encodeURIComponent(config.projectId);
    timelinePageUrl.search = "";
    timelinePageUrl.searchParams.set(
      "side",
      "deployment-task-timeline:" + config.projectId + ":" + taskId
    );
    const timelineRequestPromise = page.waitForRequest(
      request => {
        const url = new URL(request.url());
        return request.method() === "GET" &&
          url.pathname === "/api/deploy-tasks/" + encodeURIComponent(taskId) + "/timeline";
      },
      { timeout: 60000 }
    );
    await page.goto(timelinePageUrl.toString(), { waitUntil: "domcontentloaded" });
    const timelineRequest = await timelineRequestPromise;
    const timelineHeaders = await timelineRequest.allHeaders();
    const timelineApiUrl = timelineRequest.url();
    const deadline = Date.now() + config.timeoutMs;
    let snapshot = null;

    while (Date.now() < deadline) {
      const response = await page.request.get(timelineApiUrl, {
        failOnStatusCode: false,
        headers: timelineHeaders,
        timeout: 30000,
      });
      if (!response.ok()) {
        return finish({
          code: "timeline_request_failed",
          mode: "submit",
          ok: false,
          taskId,
          timelineHttpStatus: response.status(),
        });
      }
      snapshot = await response.json();
      if (terminalStatuses.has(snapshot?.task?.status)) break;
      await page.waitForTimeout(2000);
    }

    const task = snapshot?.task;
    if (task == null || !terminalStatuses.has(task.status)) {
      return finish({
        code: "task_timeout",
        mode: "submit",
        ok: false,
        phase: task?.phase ?? null,
        status: task?.status ?? null,
        taskId,
      });
    }

    const resultUrl =
      typeof task.resultUrl === "string" && task.resultUrl !== ""
        ? task.resultUrl
        : typeof task.previewUrl === "string" && task.previewUrl !== ""
          ? task.previewUrl
          : null;
    let publicHttpStatus = null;
    if (task.status === "completed" && resultUrl != null) {
      const publicResponse = await page.request.get(resultUrl, {
        failOnStatusCode: false,
        timeout: 30000,
      }).catch(() => null);
      publicHttpStatus = publicResponse?.status() ?? null;
    }

    const completed =
      task.status === "completed" &&
      task.phase === "completed" &&
      task.runner?.kind === "ai";
    const publicUrlHealthy =
      resultUrl == null ||
      (publicHttpStatus != null && publicHttpStatus >= 200 && publicHttpStatus < 300);
    const ok = completed && publicUrlHealthy;
    const blockingInputKeys = Array.isArray(task.blockingInputs)
      ? task.blockingInputs.map(input => input.key ?? input.id ?? input.name).filter(Boolean)
      : [];

    return finish({
      blockingInputKeys,
      code: ok ? "deployment_completed" : "deployment_not_completed",
      completedAt: task.completedAt ?? null,
      failureReason: task.failureDetails?.reason ?? null,
      mode: "submit",
      ok,
      phase: task.phase,
      projectId: typeof projectId === "string" ? projectId : config.projectId,
      publicHttpStatus,
      resultUrl: resultUrl == null ? null : safeUrl(resultUrl),
      runnerKind: task.runner?.kind ?? null,
      sourceRepo: task.source?.kind === "github" ? task.source.repo?.fullName ?? null : null,
      status: task.status,
      taskId,
    });
  } catch (error) {
    return finish({
      code: "playwright_flow_failed",
      error: safeError(error),
      mode: config.submit ? "submit" : "inspect",
      ok: false,
      repoUrl: config.repoUrl,
    });
  }
}`;
}

async function executable(pathname) {
  try {
    await access(pathname, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function playwrightCliInvocation() {
  const configured = process.env.PWCLI?.trim();
  if (configured) {
    return { command: configured, prefix: [] };
  }
  const candidates = [
    path.join(homedir(), ".codex/skills/playwright/scripts/playwright_cli.sh"),
    path.join(homedir(), ".agents/skills/playwright/scripts/playwright_cli.sh"),
  ];
  for (const candidate of candidates) {
    if (await executable(candidate)) {
      return { command: candidate, prefix: [] };
    }
  }
  return {
    command: "npx",
    prefix: ["--yes", "--package", "@playwright/cli", "playwright-cli"],
  };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code: code ?? 1, stderr, stdout });
        return;
      }
      reject(
        new Error(
          `${path.basename(command)} exited with code ${code ?? 1}: ${stderr || stdout}`
        )
      );
    });
  });
}

function sanitizedProcessError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/authorization[^\n]*/gi, "authorization: [REDACTED]")
    .slice(0, 1000);
}

async function assertLocalServer(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(baseUrl, {
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Local Brain returned HTTP ${response.status}.`);
    }
  } catch (error) {
    throw new Error(
      `Local Brain is not reachable at ${baseUrl}. Start it with bun dev before running this smoke test. (${sanitizedProcessError(error)})`
    );
  } finally {
    clearTimeout(timer);
  }
}

export function parseFlowResult(stdout) {
  const trimmed = stdout.trim();
  let output = trimmed;
  if (trimmed.startsWith('"')) {
    const decoded = JSON.parse(trimmed);
    if (typeof decoded === "string") {
      output = decoded;
    }
  }
  const markerIndex = output.lastIndexOf(RESULT_MARKER);
  if (markerIndex < 0) {
    throw new Error("Playwright flow did not return a smoke result.");
  }
  const afterMarker = output.slice(markerIndex + RESULT_MARKER.length);
  const firstLine = afterMarker.split(LINE_BREAK_RE, 1)[0]?.trim();
  if (!firstLine) {
    throw new Error("Playwright flow returned an empty smoke result.");
  }
  return JSON.parse(firstLine);
}

function exitCodeForSummary(summary) {
  if (summary.ok) {
    return 0;
  }
  if (summary.status === "blocked") {
    return 3;
  }
  return 1;
}

async function main() {
  let options;
  try {
    options = parseGithubDeploySmokeArgs(process.argv.slice(2));
  } catch (error) {
    console.error(sanitizedProcessError(error));
    console.error(`\n${usage()}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  await assertLocalServer(options.baseUrl);
  const root = path.resolve(
    fileURLToPath(new URL("../../..", import.meta.url))
  );
  const outputDir = path.resolve(
    root,
    options.outputDir ||
      path.join("output/playwright/github-deploy", timestampDirectoryName())
  );
  await mkdir(outputDir, { recursive: true });

  const session = options.session || `brain-github-smoke-${process.pid}`;
  const screenshotPath = path.join(outputDir, "final.png");
  const snapshotPath = path.join(outputDir, "initial-snapshot.yml");
  const flowPath = path.join(outputDir, "flow.js");
  const summaryPath = path.join(outputDir, "summary.json");
  const pageUrl = projectDeploymentUrl(options);
  const flow = buildGithubDeploySmokeFlow({
    projectId: options.projectId,
    repoUrl: options.repoUrl,
    submit: options.submit,
    timeoutMs: options.timeoutMs,
  });
  await writeFile(flowPath, flow, { mode: 0o600 });

  const cli = await playwrightCliInvocation();
  const invoke = (args) =>
    runProcess(cli.command, [...cli.prefix, `-s=${session}`, ...args], {
      cwd: root,
    });
  let summary;
  let opened = false;
  try {
    console.log(
      `[github-deploy-smoke] ${options.submit ? "SUBMIT" : "INSPECT"} ${options.repoUrl} -> project ${options.projectId}`
    );
    await invoke(["open", pageUrl, ...(options.headed ? ["--headed"] : [])]);
    opened = true;
    await invoke(["snapshot", `--filename=${snapshotPath}`]);
    const result = await invoke([
      "--raw",
      "run-code",
      `--filename=${flowPath}`,
    ]);
    summary = parseFlowResult(result.stdout);
  } catch (error) {
    summary = {
      code: "playwright_cli_failed",
      error: sanitizedProcessError(error),
      finishedAt: new Date().toISOString(),
      mode: options.submit ? "submit" : "inspect",
      ok: false,
    };
  } finally {
    if (opened) {
      await invoke(["screenshot", `--filename=${screenshotPath}`]).catch(
        () => undefined
      );
      await invoke(["close"]).catch(() => undefined);
    }
  }

  const report = {
    ...summary,
    artifacts: {
      screenshot: existsSync(screenshotPath) ? screenshotPath : null,
      snapshot: existsSync(snapshotPath) ? snapshotPath : null,
    },
    baseUrl: options.baseUrl,
    projectId: summary.projectId ?? options.projectId,
    repoUrl: options.repoUrl,
  };
  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Summary: ${summaryPath}`);
  process.exitCode = exitCodeForSummary(report);
}

const isEntrypoint =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) {
  main().catch((error) => {
    console.error(sanitizedProcessError(error));
    process.exitCode = 1;
  });
}
