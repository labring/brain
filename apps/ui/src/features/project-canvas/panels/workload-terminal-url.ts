import { API_ROUTES } from "@workspace/api/constants";

const LOCALHOST_PORT_PATTERN = /:\d+$/;

function apiOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured;
  }
  if (typeof window !== "undefined") {
    return window.location.origin.replace(LOCALHOST_PORT_PATTERN, ":9000");
  }
  return "http://localhost:9000";
}

export function workloadTerminalWebSocketUrl(): string {
  const url = new URL(API_ROUTES.k8s.exec, apiOrigin());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
