import "server-only";

import { Client } from "pg";

import { getAppPostgresPool } from "@/lib/app-postgres/db";

import {
  DEPLOY_TASK_NOTIFY_CHANNEL,
  type DeployTaskNotifyListener,
  type DeployTaskNotifyMessage,
  type DeployTaskNotifyTransport,
  parseDeployTaskNotifyMessage,
} from "./notify";

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

interface ListenerState {
  client: Client | null;
  connecting: Promise<void> | null;
  reconnectAttempt: number;
  stopped: boolean;
  subscribers: Set<DeployTaskNotifyListener>;
}

const globalNotify = globalThis as unknown as {
  __sealaiDeployTaskNotify?: ListenerState;
};

function getState(): ListenerState {
  globalNotify.__sealaiDeployTaskNotify ??= {
    client: null,
    connecting: null,
    reconnectAttempt: 0,
    stopped: false,
    subscribers: new Set(),
  };
  return globalNotify.__sealaiDeployTaskNotify;
}

function dispatch(state: ListenerState, payload: string | undefined): void {
  const message = parseDeployTaskNotifyMessage(payload);
  if (message == null) {
    return;
  }
  for (const listener of [...state.subscribers]) {
    try {
      listener(message);
    } catch (error) {
      console.error("[deploy-task-notify] listener failed:", error);
    }
  }
}

function dispatchReset(state: ListenerState): void {
  for (const listener of [...state.subscribers]) {
    try {
      listener({ kind: "reset" });
    } catch (error) {
      console.error("[deploy-task-notify] reset listener failed:", error);
    }
  }
}

function scheduleReconnect(state: ListenerState): void {
  if (state.stopped) {
    return;
  }
  const delay =
    RECONNECT_DELAYS_MS[
      Math.min(state.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ];
  state.reconnectAttempt += 1;
  setTimeout(() => {
    ensureListening(state, { afterReconnect: true }).catch((error) => {
      console.error("[deploy-task-notify] reconnect failed:", error);
      scheduleReconnect(state);
    });
  }, delay).unref?.();
}

/**
 * LISTEN requires a dedicated connection — never a pooled one. After a
 * reconnect, subscribers get a `reset` event because notifications during
 * the gap are lost; stream handlers re-bootstrap from a fresh read.
 */
async function ensureListening(
  state: ListenerState,
  options: { afterReconnect?: boolean } = {}
): Promise<void> {
  if (state.client != null || state.stopped) {
    return;
  }
  if (state.connecting != null) {
    await state.connecting;
    return;
  }
  state.connecting = (async () => {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      throw new Error("DATABASE_URL is required for deploy task streaming.");
    }
    const client = new Client({ connectionString: url });
    client.on("notification", (message) => {
      if (message.channel === DEPLOY_TASK_NOTIFY_CHANNEL) {
        dispatch(state, message.payload);
      }
    });
    client.on("error", (error) => {
      console.error("[deploy-task-notify] listen connection error:", error);
    });
    client.on("end", () => {
      if (state.client === client) {
        state.client = null;
        scheduleReconnect(state);
      }
    });
    await client.connect();
    await client.query(`LISTEN "${DEPLOY_TASK_NOTIFY_CHANNEL}"`);
    state.client = client;
    state.reconnectAttempt = 0;
    if (options.afterReconnect) {
      dispatchReset(state);
    }
  })();
  try {
    await state.connecting;
  } finally {
    state.connecting = null;
  }
}

async function publish(message: DeployTaskNotifyMessage): Promise<void> {
  await getAppPostgresPool().query("select pg_notify($1, $2)", [
    DEPLOY_TASK_NOTIFY_CHANNEL,
    JSON.stringify(message),
  ]);
}

export function getDeployTaskNotifyTransport(): DeployTaskNotifyTransport {
  const state = getState();
  return {
    publish,
    async subscribe(listener) {
      state.subscribers.add(listener);
      await ensureListening(state);
      return () => {
        state.subscribers.delete(listener);
      };
    },
  };
}
