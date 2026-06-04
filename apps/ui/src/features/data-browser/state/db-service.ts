import type { DataBrowserHostContext } from "@data-browser/api/access-types";

export function dbAccessSessionKeyFromRuntime(
  runtime: Pick<
    DataBrowserHostContext,
    "databaseWorkloadName" | "databaseWorkloadNamespace" | "projectId"
  >
): string {
  return `${runtime.projectId}:${runtime.databaseWorkloadNamespace}:${runtime.databaseWorkloadName}`;
}

export function dbAccessExpandedStorageKey(
  runtime: Pick<
    DataBrowserHostContext,
    "databaseWorkloadName" | "databaseWorkloadNamespace" | "projectId"
  >
): string {
  return `data-browser:expanded:${dbAccessSessionKeyFromRuntime(runtime)}`;
}
