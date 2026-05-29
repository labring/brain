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

export interface DeviconAsset {
  original: string | { src: string };
  plain: string | { src: string };
}

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

export function deviconSrc(src: string | { src: string }): string {
  return typeof src === "string" ? src : src.src;
}
