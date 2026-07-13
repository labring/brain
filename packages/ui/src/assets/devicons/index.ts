import dockerOriginal from "./docker-original.svg";
import dockerPlain from "./docker-plain.svg";
import mongodbOriginal from "./mongodb-original.svg";
import mongodbPlain from "./mongodb-plain.svg";
import mysqlOriginal from "./mysql-original.svg";
import mysqlPlain from "./mysql-plain-wordmark.svg";
import postgresqlOriginal from "./postgresql-original.svg";
import postgresqlPlain from "./postgresql-plain.svg";
import redisOriginal from "./redis-original.svg";
import redisPlain from "./redis-plain.svg";

export type DeviconKey =
  | "docker"
  | "mongodb"
  | "mysql"
  | "postgresql"
  | "redis";

export type DatabaseDeviconKey = Exclude<DeviconKey, "docker">;

export interface DeviconAsset {
  original: string | { src: string };
  plain: string | { src: string };
}

export type DeviconVariant = keyof DeviconAsset;

export const devicons = {
  docker: {
    original: dockerOriginal,
    plain: dockerPlain,
  },
  mongodb: {
    original: mongodbOriginal,
    plain: mongodbPlain,
  },
  mysql: {
    original: mysqlOriginal,
    plain: mysqlPlain,
  },
  postgresql: {
    original: postgresqlOriginal,
    plain: postgresqlPlain,
  },
  redis: {
    original: redisOriginal,
    plain: redisPlain,
  },
} as const satisfies Record<DeviconKey, DeviconAsset>;

const DATABASE_DEVICON_KEY_BY_ENGINE: Readonly<
  Record<string, DatabaseDeviconKey>
> = {
  mongo: "mongodb",
  mongodb: "mongodb",
  mysql: "mysql",
  pg: "postgresql",
  postgres: "postgresql",
  postgresql: "postgresql",
  redis: "redis",
};

export function databaseDeviconKey(
  engine: string | null | undefined
): DatabaseDeviconKey | undefined {
  if (engine == null) {
    return undefined;
  }
  return DATABASE_DEVICON_KEY_BY_ENGINE[engine.trim().toLowerCase()];
}

export function databaseDeviconSrc(
  engine: string | null | undefined,
  variant: DeviconVariant = "original"
): string | undefined {
  const iconKey = databaseDeviconKey(engine);
  return iconKey === undefined
    ? undefined
    : deviconSrc(devicons[iconKey][variant]);
}

export function deviconSrc(src: string | { src: string }): string {
  return typeof src === "string" ? src : src.src;
}
