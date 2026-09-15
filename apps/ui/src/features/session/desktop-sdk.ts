"use client";

import { EVENT_NAME } from "@labring/sealos-desktop-sdk";
import { createSealosApp, sealosApp } from "@labring/sealos-desktop-sdk/app";

/**
 * The SDK boundary (ADR-0083, spec §A.6): Brain keeps the Desktop SDK for
 * Desktop *state* — the handshake, the current `nsid`, the host domain, the
 * language and its change event, `openApp` — and never for credentials.
 * The return types below carry no kubeconfig, token, or user-display
 * fields, so no fallback to SDK-delivered credentials can be added without
 * changing a type here.
 */

/** What Brain reads from Desktop's session: the current Workspace only. */
export interface DesktopShellState {
  /** Desktop's current namespace id (`ns-…`). */
  nsid: string;
}

/** Whether this page runs inside a Desktop iframe (or any parent frame). */
export function isInsideDesktopIframe(): boolean {
  try {
    return typeof window !== "undefined" && window.top !== window;
  } catch {
    // A cross-origin `window.top` throws on access in some browsers; that
    // still means there is a parent.
    return true;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/**
 * The SDK answers within its own 10 s budget inside the Desktop iframe.
 * Outside one (local development), only the Sealos App Dev Bridge extension
 * can answer, so an unanswered read is given up quickly instead of holding
 * the session for the SDK's full timeout.
 */
const OUTSIDE_IFRAME_SDK_TIMEOUT_MS = 1500;
const INSIDE_IFRAME_SDK_TIMEOUT_MS = 12_000;

function sdkTimeoutMs(): number {
  return isInsideDesktopIframe()
    ? INSIDE_IFRAME_SDK_TIMEOUT_MS
    : OUTSIDE_IFRAME_SDK_TIMEOUT_MS;
}

/** Desktop's current Workspace, or null when no shell (or bridge) answers. */
export async function readDesktopShellState(): Promise<DesktopShellState | null> {
  const session = await withTimeout(sealosApp.getSession(), sdkTimeoutMs());
  const nsid = session?.user?.nsid?.trim() ?? "";
  return nsid === "" ? null : { nsid };
}

/** Desktop's language, or null when nothing answers. */
export async function readDesktopLanguage(): Promise<string | null> {
  const language = await withTimeout(sealosApp.getLanguage(), sdkTimeoutMs());
  const lng = language?.lng?.trim() ?? "";
  return lng === "" ? null : lng;
}

/** Desktop's cloud domain from the host config, or null when nothing answers. */
export async function readDesktopDomain(): Promise<string | null> {
  const hostConfig = await withTimeout(
    sealosApp.getHostConfig(),
    sdkTimeoutMs()
  );
  const domain = hostConfig?.cloud?.domain?.trim() ?? "";
  return domain === "" ? null : domain;
}

function eventLanguage(event: unknown): string {
  if (typeof event === "string") {
    return event.trim();
  }
  if (
    typeof event === "object" &&
    event !== null &&
    "lng" in event &&
    typeof event.lng === "string"
  ) {
    return event.lng.trim();
  }
  return "";
}

/**
 * Runs the SDK handshake for the page's lifetime and forwards Desktop's
 * language changes. Returns the teardown.
 */
export function connectDesktopSdk(handlers: {
  onLanguageChange: (language: string) => void;
}): () => void {
  const cleanup = createSealosApp();
  const unsubscribe = sealosApp.addAppEventListen(
    EVENT_NAME.CHANGE_I18N,
    (event) => {
      const language = eventLanguage(event);
      if (language !== "") {
        handlers.onLanguageChange(language);
      }
    }
  );
  return () => {
    unsubscribe?.();
    cleanup?.();
  };
}
