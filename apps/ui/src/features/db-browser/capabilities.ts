import type { DataBrowserEngine } from "./api/engine";

export const DATA_BROWSER_CAPABILITIES = {
  actions: {
    backendFilter: false,
    chart: false,
    complexExport: false,
    query: false,
    refresh: true,
    singleObjectExport: true,
    systemObjectsToggle: false,
    write: false,
  },
  visibleEngines: new Set<DataBrowserEngine>([
    "POSTGRES",
    "MYSQL",
    "MONGODB",
    "REDIS",
  ]),
  visibleObjectKinds: new Set([
    "database",
    "schema",
    "table",
    "view",
    "collection",
    "key",
  ]),
} as const;

export function isDataBrowserEngineVisible(engine: DataBrowserEngine): boolean {
  return DATA_BROWSER_CAPABILITIES.visibleEngines.has(engine);
}
