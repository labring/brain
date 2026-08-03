"use client";

import { useEffect, useRef } from "react";
import { type BrainGtmMethod, trackBrainGtmEvent } from "./brain-gtm";

export function BrainDeploymentStart({ open }: { open: boolean }) {
  const previousOpenRef = useRef(false);

  useEffect(() => {
    if (open && !previousOpenRef.current) {
      trackBrainGtmEvent({ event: "deployment_start" });
    }
    previousOpenRef.current = open;
  }, [open]);

  return null;
}

export function BrainModuleView({
  method,
  projectId,
  viewName,
}: {
  method?: BrainGtmMethod;
  projectId?: string;
  viewName:
    | "ai_chat_engaged"
    | "config_form"
    | "project_dashboard"
    | "project_list";
}) {
  const eventKey = `${viewName}:${projectId ?? ""}:${method ?? ""}`;
  const sentEventKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (sentEventKeyRef.current === eventKey) {
      return;
    }
    sentEventKeyRef.current = eventKey;
    trackBrainGtmEvent({
      ...(method === undefined ? {} : { method }),
      ...(projectId === undefined ? {} : { project_id: projectId }),
      event: "module_view",
      view_name: viewName,
    });
  }, [eventKey, method, projectId, viewName]);

  return null;
}
