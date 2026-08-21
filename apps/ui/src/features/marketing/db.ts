import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { identityUidCanonicalizations } from "@/features/chat/persistence/schema";
import { getAppPostgresPool } from "@/lib/app-postgres/db";
import {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
} from "./schema";

const marketingSchema = {
  identityUidCanonicalizations,
  marketingAttributionSubjects,
  marketingLifecycleEvents,
};

export type MarketingPgDatabase = PgDatabase<
  PgQueryResultHKT,
  typeof marketingSchema
>;

let marketingDbInstance: MarketingPgDatabase | undefined;

export function getMarketingDb(): MarketingPgDatabase {
  marketingDbInstance ??= drizzle(getAppPostgresPool(), {
    schema: marketingSchema,
  }) as MarketingPgDatabase;
  return marketingDbInstance;
}
