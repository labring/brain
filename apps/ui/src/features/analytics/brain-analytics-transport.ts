"use client";

import { sendGTMEvent } from "@next/third-parties/google";

type AnalyticsPayload = Record<string, unknown>;
type DesktopTransport = (payload: AnalyticsPayload) => Promise<unknown>;

let desktopTransport: DesktopTransport | null | undefined;
const pendingEvents: AnalyticsPayload[] = [];
const MAX_PENDING_EVENTS = 100;

function dispatch(payload: AnalyticsPayload): void {
  if (desktopTransport) {
    // An acknowledged Desktop owns delivery; never also send through iframe GTM.
    desktopTransport(payload).catch(() => {
      console.warn("[Brain GTM] Desktop event delivery failed.");
    });
  } else {
    sendGTMEvent(payload);
  }
}

/** Resolve once the existing SDK reports the parent's analytics capability. */
export function configureBrainAnalyticsTransport(
  transport: DesktopTransport | null | undefined
): void {
  desktopTransport = transport;
  if (transport === undefined) {
    return;
  }
  for (const payload of pendingEvents.splice(0)) {
    dispatch(payload);
  }
}

export function sendBrainAnalyticsEvent(payload: AnalyticsPayload): void {
  const embedded = window.parent && window.parent !== window;
  if (embedded && desktopTransport === undefined) {
    if (pendingEvents.length < MAX_PENDING_EVENTS) {
      pendingEvents.push(payload);
    }
    return;
  }
  dispatch(payload);
}
