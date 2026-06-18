import { API_ROUTES } from "@workspace/api/constants";

const TERMINAL_URL_CONFIG_PATH = "/api/project-canvas/terminal-url";

interface TerminalUrlConfig {
  webSocketUrl?: unknown;
}

function fallbackWebSocketUrl(): string {
  const base =
    typeof window === "undefined"
      ? "http://localhost:3000"
      : window.location.origin;
  const url = new URL(API_ROUTES.k8s.exec, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export async function workloadTerminalWebSocketUrl(): Promise<string> {
  try {
    const response = await fetch(TERMINAL_URL_CONFIG_PATH, {
      cache: "no-store",
    });
    if (!response.ok) {
      return fallbackWebSocketUrl();
    }
    const config = (await response.json()) as TerminalUrlConfig;
    if (typeof config.webSocketUrl === "string" && config.webSocketUrl !== "") {
      return config.webSocketUrl;
    }
  } catch {
    return fallbackWebSocketUrl();
  }
  return fallbackWebSocketUrl();
}
