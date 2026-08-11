"use client";

import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { mutate } from "swr";

import { devTweaksStore } from "@/features/dev-tweaks/dev-tweaks-store";
import {
  BILLING_DEV_MOCK_COOKIE,
  BILLING_DEV_SCENARIOS,
  type BillingDevMockState,
  type BillingDevScenario,
  DEFAULT_BILLING_DEV_SCENARIO,
  formatBillingDevMockCookie,
  parseBillingDevMockCookie,
} from "./dev-mock-cookie";

const DISABLED_STATE: BillingDevMockState = Object.freeze({
  enabled: false,
  scenario: DEFAULT_BILLING_DEV_SCENARIO,
});

/**
 * Client view of the billing dev-mock session cookie. The cookie is the only
 * store — this class just mirrors it for React and watches for changes made
 * elsewhere (the server's Set-Cookie scenario transitions in particular).
 */
class BillingDevMockStore {
  private readonly listeners = new Set<() => void>();
  private readonly onExternalChange = () => this.readCookie();
  private state: BillingDevMockState = DISABLED_STATE;
  private watchTimer: number | undefined;

  getSnapshot = (): BillingDevMockState => this.state;

  setState(next: BillingDevMockState) {
    // biome-ignore lint/suspicious/noDocumentCookie: the synchronous write must land before the SWR refetches fire; the async Cookie Store API cannot guarantee that.
    document.cookie = `${BILLING_DEV_MOCK_COOKIE}=${formatBillingDevMockCookie(next)}; path=/; samesite=lax`;
    this.readCookie();
    // The scenario shapes every /api/billing/* answer, so drop the whole SWR
    // cache — billing keys refetch, everything else is untouched data-wise.
    mutate(() => true).catch(() => undefined);
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.listeners.size === 0) {
      this.startWatching();
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopWatching();
      }
    };
  };

  // Server-side transitions rewrite the cookie behind React's back; the
  // Cookie Store API pushes those, the focus/interval pair is the fallback.
  private startWatching() {
    if (typeof document === "undefined") {
      return;
    }
    this.readCookie();
    const cookieStore = (window as { cookieStore?: EventTarget }).cookieStore;
    cookieStore?.addEventListener("change", this.onExternalChange);
    window.addEventListener("focus", this.onExternalChange);
    if (cookieStore == null) {
      this.watchTimer = window.setInterval(this.onExternalChange, 3000);
    }
  }

  private stopWatching() {
    if (typeof document === "undefined") {
      return;
    }
    const cookieStore = (window as { cookieStore?: EventTarget }).cookieStore;
    cookieStore?.removeEventListener("change", this.onExternalChange);
    window.removeEventListener("focus", this.onExternalChange);
    if (this.watchTimer != null) {
      window.clearInterval(this.watchTimer);
      this.watchTimer = undefined;
    }
  }

  private readCookie() {
    const pair = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${BILLING_DEV_MOCK_COOKIE}=`));
    const parsed = parseBillingDevMockCookie(
      pair?.slice(BILLING_DEV_MOCK_COOKIE.length + 1)
    );
    const next = parsed.kind === "set" ? parsed.state : DISABLED_STATE;
    if (
      next.enabled === this.state.enabled &&
      next.scenario === this.state.scenario
    ) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const billingDevMockStore = new BillingDevMockStore();

const getServerState = () => DISABLED_STATE;

function useBillingDevMock(): BillingDevMockState {
  return useSyncExternalStore(
    billingDevMockStore.subscribe,
    billingDevMockStore.getSnapshot,
    getServerState
  );
}

/**
 * "Billing mock" section for the dev tweaks pane — billing owns this UI; the
 * dev-tweaks mount point composes it into the pane as children.
 */
export function BillingDevMockSection() {
  const state = useBillingDevMock();
  return (
    <section className="flex flex-col gap-2.5">
      <header className="min-w-0">
        <h3 className="truncate font-medium text-xs">Billing mock</h3>
        <p className="truncate text-muted-foreground text-xs">
          Serves /api/billing/* from fixtures
        </p>
      </header>
      <div className="flex items-center justify-between gap-2">
        <label
          className="text-muted-foreground text-xs"
          htmlFor="billing-dev-mock-enabled"
        >
          Mock data
        </label>
        <Switch
          checked={state.enabled}
          id="billing-dev-mock-enabled"
          onCheckedChange={(enabled) =>
            billingDevMockStore.setState({ ...state, enabled })
          }
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <label
          className={cn(
            "text-xs",
            state.enabled ? "text-foreground" : "text-muted-foreground"
          )}
          htmlFor="billing-dev-mock-scenario"
        >
          Scenario
        </label>
        <select
          className="max-w-40 rounded border bg-transparent px-1 py-0.5 text-xs disabled:opacity-50"
          disabled={!state.enabled}
          id="billing-dev-mock-scenario"
          onChange={(event) =>
            billingDevMockStore.setState({
              enabled: true,
              scenario: event.target.value as BillingDevScenario,
            })
          }
          value={state.scenario}
        >
          {BILLING_DEV_SCENARIOS.map((scenario) => (
            <option key={scenario} value={scenario}>
              {scenario}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

/**
 * Always-on reminder that fake data is being served — persisted mock state is
 * easy to forget. Clicking it opens the dev tweaks pane.
 */
export function BillingDevMockBadge() {
  const state = useBillingDevMock();
  if (!state.enabled) {
    return null;
  }
  return createPortal(
    <button
      className="fixed bottom-3 left-3 z-[60] flex items-center gap-1.5 rounded-full border bg-popover/95 px-2.5 py-1 font-medium text-popover-foreground text-xs shadow-md backdrop-blur-sm transition-colors hover:bg-accent"
      onClick={() => devTweaksStore.setOpen(true)}
      title="Billing mock data is on — click to open dev tweaks"
      type="button"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
      MOCK · {state.scenario}
    </button>,
    document.body
  );
}
