import type { DatabaseDeploymentChoice } from "@workspace/ui/components/database-deployer";

export const DIRECT_DB_DEPLOYMENT_OPTIONS = [
  {
    engine: "mysql",
    id: "mysql",
    label: "MySQL",
  },
  {
    engine: "postgresql",
    id: "postgresql",
    label: "PostgreSQL",
  },
  {
    engine: "redis",
    id: "redis",
    label: "Redis",
  },
  {
    engine: "mongodb",
    id: "mongodb",
    label: "MongoDB",
  },
] satisfies readonly DatabaseDeploymentChoice[];
