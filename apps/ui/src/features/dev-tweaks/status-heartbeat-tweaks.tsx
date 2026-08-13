"use client";

import { type DevTweaksGroupDef, useDevTweaks } from "@workspace/dev-tweaks";
import { setStatusHeartbeatPeriodMs } from "@workspace/ui/lib/status-heartbeat";
import { useEffect } from "react";

/**
 * Defaults mirror DEFAULT_PERIOD_MS in status-heartbeat.ts and the
 * `--status-heartbeat-pulse` fallback in globals.css. Idle rendering cost
 * scales with the duty cycle (pulse ÷ period), so a denser beat stays cheap
 * as long as the pulse shortens with it.
 */
const STATUS_HEARTBEAT_TWEAKS = {
  controls: {
    period: {
      label: "Beat period",
      max: 10,
      min: 1.5,
      step: 0.5,
      type: "slider",
      unit: "s",
      value: 2,
    },
    pulse: {
      label: "Pulse duration",
      max: 1.5,
      min: 0.3,
      step: 0.1,
      type: "slider",
      unit: "s",
      value: 1,
    },
  },
  feature: "status",
  kind: "tweak",
  note: "status-heartbeat.ts → DEFAULT_PERIOD_MS; globals.css → --status-heartbeat-pulse",
  title: "Status dots · heartbeat",
} as const satisfies DevTweaksGroupDef;

/**
 * Renders nothing — bridges the dev tweaks knob to the heartbeat scheduler,
 * which is JS-driven and can't read a component-scoped CSS variable. Mounted
 * globally because no single component owns the shared heartbeat.
 */
export function StatusHeartbeatTweaks() {
  const { values } = useDevTweaks("status-heartbeat", STATUS_HEARTBEAT_TWEAKS);

  useEffect(() => {
    setStatusHeartbeatPeriodMs(values.period * 1000);
  }, [values.period]);

  useEffect(() => {
    // Written on :root because the pulse spans surfaces (canvas dots, dock)
    // with no shared styleable ancestor below <html>.
    document.documentElement.style.setProperty(
      "--status-heartbeat-pulse",
      `${values.pulse}s`
    );
  }, [values.pulse]);

  return null;
}
