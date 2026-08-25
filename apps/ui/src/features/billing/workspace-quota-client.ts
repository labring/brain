"use client";

import { sealosApp } from "@labring/sealos-desktop-sdk/app";
import {
  parseWorkspaceQuotaItems,
  type WorkspaceResourceQuotaSnapshot,
} from "./workspace-resource-quota";

export async function loadWorkspaceQuotaSnapshot(): Promise<
  WorkspaceResourceQuotaSnapshot | undefined
> {
  try {
    const snapshot = await sealosApp.getWorkspaceQuota();
    const items = parseWorkspaceQuotaItems(snapshot?.quota);
    return items.length === 0 ? undefined : { items };
  } catch {
    return undefined;
  }
}
