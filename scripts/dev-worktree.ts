import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

const FIRST_PORT = 20_000;
const PORT_BLOCK_SIZE = 10;
const PORT_BLOCK_COUNT = 2000;

interface DevPlan {
  environment: {
    API_PORT: string;
    API_URL: string;
    REGISTRY_PORT: string;
    UI_PORT: string;
  };
  key: string;
  ports: {
    api: number;
    registry: number;
    ui: number;
  };
  urls: {
    api: string;
    apiDocs: string;
    registry: string;
    ui: string;
  };
}

function hashKey(key: string): number {
  let hash = 0x81_1c_9d_c5;
  for (const byte of new TextEncoder().encode(key)) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a is defined in terms of XOR.
    hash ^= byte;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: Convert the signed product to uint32.
  return hash >>> 0;
}

function planForBlock(key: string, block: number): DevPlan {
  const ui = FIRST_PORT + block * PORT_BLOCK_SIZE;
  const api = ui + 1;
  const registry = ui + 2;
  const apiUrl = `http://localhost:${api}`;

  return {
    environment: {
      API_PORT: String(api),
      API_URL: apiUrl,
      REGISTRY_PORT: String(registry),
      UI_PORT: String(ui),
    },
    key,
    ports: { api, registry, ui },
    urls: {
      api: apiUrl,
      apiDocs: `${apiUrl}/docs`,
      registry: `http://localhost:${registry}`,
      ui: `http://localhost:${ui}`,
    },
  };
}

function isPortAvailable(port: number): Promise<boolean> {
  const server = createServer();
  server.unref();

  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function planForKey(key: string): Promise<DevPlan> {
  const preferredBlock = hashKey(key) % PORT_BLOCK_COUNT;

  for (let offset = 0; offset < PORT_BLOCK_COUNT; offset += 1) {
    const block = (preferredBlock + offset) % PORT_BLOCK_COUNT;
    const plan = planForBlock(key, block);
    const available = await Promise.all(
      Object.values(plan.ports).map(isPortAvailable)
    );
    if (available.every(Boolean)) {
      return plan;
    }
  }

  throw new Error("No free worktree development port block is available");
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

interface ServiceExit {
  code: number;
  error?: Error;
  name: string;
}

interface RunningService {
  child: ReturnType<typeof spawn>;
  exited: Promise<ServiceExit>;
  name: string;
}

function startService(
  name: string,
  cwd: string,
  command: string,
  commandArgs: string[],
  environment: Record<string, string>
): RunningService {
  const child = spawn(command, commandArgs, {
    cwd,
    env: {
      ...process.env,
      ...environment,
    },
    stdio: "inherit",
  });
  const exited = new Promise<ServiceExit>((resolve) => {
    child.once("error", (error) => resolve({ code: 1, error, name }));
    child.once("close", (code) => resolve({ code: code ?? 1, name }));
  });
  return { child, exited, name };
}

function stopServices(
  services: RunningService[],
  signal: NodeJS.Signals
): void {
  for (const service of services) {
    if (service.child.exitCode === null && service.child.signalCode === null) {
      service.child.kill(signal);
    }
  }
}

const args = process.argv.slice(2);
const repoRoot = realpathSync(process.cwd());
const key = argumentValue(args, "--key") ?? repoRoot;
const plan = await planForKey(key);

if (args.includes("--print")) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log("Worktree development servers");
  console.log(`  UI:       ${plan.urls.ui}`);
  console.log(`  API:      ${plan.urls.api}`);
  console.log(`  API docs: ${plan.urls.apiDocs}`);
  console.log(`  Registry: ${plan.urls.registry}`);
  console.log("");

  const services = [
    startService(
      "API",
      path.join(repoRoot, "apps/api"),
      "bun",
      ["run", "dev"],
      {
        API_PORT: plan.environment.API_PORT,
      }
    ),
    startService("UI", path.join(repoRoot, "apps/ui"), "bun", ["run", "dev"], {
      API_URL: plan.environment.API_URL,
      PORT: plan.environment.UI_PORT,
    }),
    startService(
      "Registry",
      path.join(repoRoot, "apps/registry"),
      "bunx",
      ["next", "dev"],
      {
        PORT: plan.environment.REGISTRY_PORT,
      }
    ),
  ];

  let requestedSignal: NodeJS.Signals | undefined;
  process.once("SIGINT", () => {
    requestedSignal = "SIGINT";
    stopServices(services, "SIGINT");
  });
  process.once("SIGTERM", () => {
    requestedSignal = "SIGTERM";
    stopServices(services, "SIGTERM");
  });

  const firstExit = await Promise.race(
    services.map((service) => service.exited)
  );
  if (!requestedSignal) {
    if (firstExit.error) {
      console.error(`${firstExit.name} failed to start:`, firstExit.error);
    } else {
      console.error(
        `${firstExit.name} exited with code ${firstExit.code}; stopping the other services.`
      );
    }
    stopServices(services, "SIGTERM");
  }
  await Promise.all(services.map((service) => service.exited));

  if (requestedSignal === "SIGINT") {
    process.exitCode = 130;
  } else if (requestedSignal === "SIGTERM") {
    process.exitCode = 143;
  } else {
    process.exitCode = firstExit.code || 1;
  }
}
