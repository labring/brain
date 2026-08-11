"use client";

import { sendGTMEvent } from "@next/third-parties/google";
import type {
  ProjectDrawerSurfaceEntry,
  ProjectMainSurfaceEntry,
  ProjectSideSurfaceEntry,
} from "@/features/panes/surface-state";

export const BRAIN_GTM_MAX_PAYLOAD_BYTES = 2048;

export type BrainGtmMethod = "github" | "docker" | "database" | "template";

export type BrainGtmCardActionEventType =
  | "status_view"
  | "history_view"
  | "logs_view"
  | "events_view"
  | "metrics_view"
  | "terminal_open"
  | "db_viewer_open";

interface BrainGtmModuleViewEvent {
  event: "module_view";
  method?: BrainGtmMethod;
  project_id?: string;
  view_name:
    | "ai_chat_engaged"
    | "config_form"
    | "project_dashboard"
    | "project_list";
}

interface BrainGtmDeploymentStartEvent {
  event: "deployment_start";
}

interface BrainGtmDeploymentCreateEvent {
  config?: {
    template_name?: string;
    template_version?: string;
  };
  event: "deployment_create";
  method: BrainGtmMethod;
}

interface BrainGtmDeploymentDeleteEvent {
  app_name: string;
  event: "deployment_delete";
  project_id: string;
  reason: "cleanup" | "failed" | "not_working" | "too_slow";
}

interface BrainGtmCardActionEvent {
  event: "deployment_card_action";
  event_type: BrainGtmCardActionEventType;
  project_id: string;
}

/** The sampling dialog's 4 steps; the dialog's appearance counts as step 1. */
export type BrainGtmOnboardingStep = 1 | 2 | 3 | 4;

// The three onboarding funnel events carry step numbers only (spec #88):
// answer values, free text, and user IDs have no fields to travel in, so the
// privacy rule is enforced by the closed union rather than by discipline.

export interface BrainGtmOnboardingStepViewEvent {
  event: "onboarding_step_view";
  step: BrainGtmOnboardingStep;
}

export interface BrainGtmOnboardingSkipEvent {
  event: "onboarding_skip";
  /** The step the person left from. */
  step: BrainGtmOnboardingStep;
}

export interface BrainGtmOnboardingCompleteEvent {
  event: "onboarding_complete";
}

export type BrainGtmEvent =
  | BrainGtmCardActionEvent
  | BrainGtmDeploymentCreateEvent
  | BrainGtmDeploymentDeleteEvent
  | BrainGtmDeploymentStartEvent
  | BrainGtmModuleViewEvent
  | BrainGtmOnboardingCompleteEvent
  | BrainGtmOnboardingSkipEvent
  | BrainGtmOnboardingStepViewEvent;

export interface BrainGtmSessionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function brainGtmEventPayloadBytes(event: BrainGtmEvent): number {
  return new TextEncoder().encode(
    JSON.stringify({ context: "app", module: "brain", ...event })
  ).byteLength;
}

export function trackBrainGtmEvent(event: BrainGtmEvent): boolean {
  try {
    const payload = {
      context: "app" as const,
      module: "brain" as const,
      ...event,
    };
    if (brainGtmEventPayloadBytes(event) >= BRAIN_GTM_MAX_PAYLOAD_BYTES) {
      console.warn("[Brain GTM] Event payload exceeds the 2KB limit.", payload);
      return false;
    }
    sendGTMEvent(payload);
    return true;
  } catch (error) {
    try {
      console.warn("[Brain GTM] Failed to send event.", error);
    } catch {
      // Analytics must remain best-effort even if logging is unavailable.
    }
    return false;
  }
}

export async function trackBrainGtmEventAfterSuccess<T>(
  operation: () => Promise<T>,
  event: BrainGtmEvent
): Promise<T> {
  const result = await operation();
  trackBrainGtmEvent(event);
  return result;
}

export function brainAiEngagementSessionKey(projectId: string): string {
  return `brain:gtm:ai-chat-engaged:${projectId.trim()}`;
}

export function claimBrainAiEngagement(
  projectId: string,
  storage: BrainGtmSessionStorage | null
): boolean {
  const normalizedProjectId = projectId.trim();
  if (!storage || normalizedProjectId === "") {
    return false;
  }

  const key = brainAiEngagementSessionKey(normalizedProjectId);
  try {
    if (storage.getItem(key) !== null) {
      return false;
    }
    storage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

export function claimBrainAiEngagementFromSession(projectId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return claimBrainAiEngagement(projectId, window.sessionStorage);
  } catch {
    return false;
  }
}

export function brainCardActionEventType(
  entry:
    | ProjectDrawerSurfaceEntry
    | ProjectMainSurfaceEntry
    | ProjectSideSurfaceEntry
): BrainGtmCardActionEventType | null {
  switch (entry.kind) {
    case "settings":
      return "status_view";
    case "apHistory":
      return "history_view";
    case "apEvents":
      return "events_view";
    case "apMetrics":
    case "dbMetrics":
      return "metrics_view";
    case "apTerminal":
    case "dbTerminal":
      return "terminal_open";
    case "dbAccess":
      return "db_viewer_open";
    case "resourceLogs":
      return "logs_view";
    default:
      return null;
  }
}
