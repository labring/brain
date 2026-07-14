"use client";

import "@/lib/auth-store";
import { getDefaultStore, Provider } from "jotai";
import type { ReactNode } from "react";

/** Use the default store so impure updates (e.g. `getDefaultStore().set` from event handlers) match `useAtom` in this tree. */
export function JotaiProvider({ children }: { children: ReactNode }) {
  return <Provider store={getDefaultStore()}>{children}</Provider>;
}
