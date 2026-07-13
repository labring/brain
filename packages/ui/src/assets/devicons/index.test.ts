import assert from "node:assert/strict";
import { test } from "node:test";

import { databaseDeviconKey, databaseDeviconSrc } from "./index";

test("databaseDeviconKey resolves database brand aliases case-insensitively", () => {
  assert.deepEqual(
    [
      " mongo ",
      "MONGODB",
      "pg",
      "POSTGRES",
      "postgresql",
      "MySQL",
      "redis",
    ].map(databaseDeviconKey),
    [
      "mongodb",
      "mongodb",
      "postgresql",
      "postgresql",
      "postgresql",
      "mysql",
      "redis",
    ]
  );
});

test("databaseDeviconKey does not borrow another brand for unknown engines", () => {
  assert.deepEqual(
    ["clickhouse", "mariadb", "tidb", "docker", ""].map(databaseDeviconKey),
    [undefined, undefined, undefined, undefined, undefined]
  );
});

test("databaseDeviconSrc resolves shared artwork variants", () => {
  assert.deepEqual(
    [
      databaseDeviconSrc("PG"),
      databaseDeviconSrc("redis", "plain"),
      databaseDeviconSrc("clickhouse"),
    ].map((src) => src?.split("/").at(-1)),
    ["postgresql-original.svg", "redis-plain.svg", undefined]
  );
});
