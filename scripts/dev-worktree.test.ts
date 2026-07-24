import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import type { Readable } from "node:stream";

function readStream(stream: Readable): Promise<string> {
  stream.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let output = "";
    stream.on("data", (chunk: string) => {
      output += chunk;
    });
    stream.once("end", () => resolve(output));
    stream.once("error", reject);
  });
}

async function printPlan(key: string) {
  const child = spawn("bun", ["run", "dev:worktree", "--print", "--key", key], {
    cwd: path.dirname(import.meta.dir),
    stdio: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    }),
    readStream(child.stderr),
    readStream(child.stdout),
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr);
  }
  return JSON.parse(stdout);
}

describe("dev:worktree CLI", () => {
  test("prints a stable isolated service plan for a worktree key", async () => {
    await expect(printPlan("a")).resolves.toEqual({
      environment: {
        API_PORT: "22201",
        API_URL: "http://localhost:22201",
        REGISTRY_PORT: "22202",
        UI_PORT: "22200",
      },
      key: "a",
      ports: {
        api: 22_201,
        registry: 22_202,
        ui: 22_200,
      },
      urls: {
        api: "http://localhost:22201",
        apiDocs: "http://localhost:22201/docs",
        registry: "http://localhost:22202",
        ui: "http://localhost:22200",
      },
    });
  });

  test("moves the whole service plan when its preferred block is occupied", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(22_200, "127.0.0.1", resolve);
    });

    try {
      const plan = await printPlan("a");
      expect(plan.ports).toEqual({
        api: 22_211,
        registry: 22_212,
        ui: 22_210,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
