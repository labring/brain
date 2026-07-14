export type DataBrowserEngine =
  | "POSTGRES"
  | "MYSQL"
  | "MONGODB"
  | "REDIS"
  | "UNSUPPORTED";

const ENGINE_BY_KEY: Record<string, DataBrowserEngine> = {
  mongo: "MONGODB",
  mongodb: "MONGODB",
  mysql: "MYSQL",
  pg: "POSTGRES",
  postgres: "POSTGRES",
  postgresql: "POSTGRES",
  redis: "REDIS",
};

export function normalizeDataBrowserEngine(
  engineKey: string | null | undefined
): DataBrowserEngine {
  if (engineKey == null) {
    return "UNSUPPORTED";
  }

  return ENGINE_BY_KEY[engineKey.trim().toLowerCase()] ?? "UNSUPPORTED";
}
