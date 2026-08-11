"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Check, Copy, Pause, Play, RotateCcw, X } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { BillingDevMockSection } from "./billing-dev-mock";
import {
  type DevTweakDef,
  devTweaksStore,
  EMPTY_DEV_TWEAK_OVERRIDES,
  formatDevTweakValue,
  type RegisteredDevTweaksGroup,
} from "./dev-tweaks-store";

const getServerOverrides = () => EMPTY_DEV_TWEAK_OVERRIDES;

export function DevTweaksPane() {
  const open = useSyncExternalStore(
    devTweaksStore.subscribe,
    devTweaksStore.isOpen,
    devTweaksStore.isOpen
  );
  const paused = useSyncExternalStore(
    devTweaksStore.subscribe,
    devTweaksStore.isPaused,
    devTweaksStore.isPaused
  );
  const groups = useSyncExternalStore(
    devTweaksStore.subscribe,
    devTweaksStore.getGroups,
    devTweaksStore.getGroups
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.code === "KeyT") {
        event.preventDefault();
        devTweaksStore.setOpen(!devTweaksStore.isOpen());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!paused) {
      return;
    }
    const styleEl = document.createElement("style");
    styleEl.textContent =
      "*, *::before, *::after { animation-play-state: paused !important; }";
    document.head.append(styleEl);
    return () => styleEl.remove();
  }, [paused]);

  if (!open) {
    return null;
  }

  // Portaled to <body> at z-[60] so it stacks above every popup layer —
  // dialogs sit at z-[51] and their pointer-blocking internal backdrop at
  // z-auto, so a debug pane rendered in-tree gets buried and its knobs
  // (e.g. the onboarding forceModal switch) become unreachable.
  return createPortal(
    <aside
      aria-label="Dev tweaks"
      className="fixed top-16 right-4 z-[60] flex max-h-[calc(100dvh-5rem)] w-80 flex-col overflow-hidden rounded-xl border bg-popover/95 text-popover-foreground shadow-xl backdrop-blur-sm"
    >
      <header className="flex items-center gap-1 border-b px-3 py-2">
        <h2 className="flex-1 truncate font-medium text-xs">Dev tweaks</h2>
        <PaneIconButton
          label={paused ? "Resume animations" : "Pause animations"}
          onClick={() => devTweaksStore.setPaused(!devTweaksStore.isPaused())}
        >
          {paused ? (
            <Play className="size-3.5" />
          ) : (
            <Pause className="size-3.5" />
          )}
        </PaneIconButton>
        <PaneIconButton
          label="Close"
          onClick={() => devTweaksStore.setOpen(false)}
        >
          <X className="size-3.5" />
        </PaneIconButton>
      </header>
      <div className="flex flex-col gap-5 overflow-y-auto p-3">
        <BillingDevMockSection />
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Nothing registered on this screen. Call useDevTweaks() in a
            component to add knobs here.
          </p>
        ) : (
          groups.map((group) => (
            <DevTweaksGroupSection group={group} key={group.key} />
          ))
        )}
      </div>
      <footer className="border-t px-3 py-1.5 text-muted-foreground text-xs">
        ⌃⌥T toggles this pane
      </footer>
    </aside>,
    document.body
  );
}

function DevTweaksGroupSection({ group }: { group: RegisteredDevTweaksGroup }) {
  const overrides = useSyncExternalStore(
    devTweaksStore.subscribe,
    () => devTweaksStore.getOverrides(group.key),
    getServerOverrides
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const entries = Object.entries(group.def.tweaks);
  const cssEntries = entries.filter(([, def]) => def.cssVar);
  const dirty = Object.keys(overrides).length > 0;

  const copyCss = () => {
    const block = cssEntries
      .map(
        ([tweakKey, def]) =>
          `  ${def.cssVar}: ${formatDevTweakValue(def, overrides[tweakKey] ?? def.value)};`
      )
      .join("\n");
    navigator.clipboard.writeText(block).then(
      () => setCopied(true),
      () => {
        // Clipboard denied — nothing useful to do in a dev pane.
      }
    );
  };

  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-xs">{group.def.title}</h3>
          {group.def.note ? (
            <p
              className="truncate text-muted-foreground text-xs"
              title={group.def.note}
            >
              {group.def.note}
            </p>
          ) : null}
        </div>
        {dirty ? (
          <PaneIconButton
            label="Reset group to defaults"
            onClick={() => devTweaksStore.clearGroupOverrides(group.key)}
          >
            <RotateCcw className="size-3.5" />
          </PaneIconButton>
        ) : null}
        {cssEntries.length > 0 ? (
          <PaneIconButton label="Copy CSS variables" onClick={copyCss}>
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </PaneIconButton>
        ) : null}
      </header>
      <div className="flex flex-col gap-2">
        {entries.map(([tweakKey, def]) => (
          <DevTweakControl
            def={def}
            groupKey={group.key}
            key={tweakKey}
            overridden={tweakKey in overrides}
            tweakKey={tweakKey}
            value={overrides[tweakKey] ?? def.value}
          />
        ))}
      </div>
    </section>
  );
}

function DevTweakControl({
  def,
  groupKey,
  overridden,
  tweakKey,
  value,
}: {
  def: DevTweakDef;
  groupKey: string;
  overridden: boolean;
  tweakKey: string;
  value: number;
}) {
  const inputId = `dev-tweak-${groupKey}-${tweakKey}`;
  const step = def.step ?? 1;
  const setValue = (next: number) => {
    if (Number.isFinite(next)) {
      devTweaksStore.setOverride(groupKey, tweakKey, next);
    }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <label
          className={cn(
            "truncate text-xs",
            overridden ? "text-foreground" : "text-muted-foreground"
          )}
          htmlFor={inputId}
        >
          {def.label}
        </label>
        <span className="flex shrink-0 items-center gap-1">
          {overridden ? (
            <button
              aria-label={`Reset ${def.label}`}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => devTweaksStore.clearOverride(groupKey, tweakKey)}
              type="button"
            >
              <RotateCcw className="size-3" />
            </button>
          ) : null}
          <input
            aria-label={`${def.label} value`}
            className="w-14 rounded border bg-transparent px-1 py-0.5 text-right text-xs tabular-nums"
            max={def.max}
            min={def.min}
            onChange={(event) => setValue(event.target.valueAsNumber)}
            step={step}
            type="number"
            value={value}
          />
          <span className="w-3 text-muted-foreground text-xs">
            {def.unit ?? ""}
          </span>
        </span>
      </div>
      <input
        className="w-full accent-primary"
        id={inputId}
        max={def.max}
        min={def.min}
        onChange={(event) => setValue(event.target.valueAsNumber)}
        step={step}
        type="range"
        value={value}
      />
    </div>
  );
}

function PaneIconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
