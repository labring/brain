import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import { getAppPostgresPool } from "@/lib/app-postgres/db";
import {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
} from "./schema";

const marketingSchema = {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
};

type MarketingDb = NodePgDatabase<typeof marketingSchema>;

let marketingDbInstance: MarketingDb | undefined;

export function getMarketingDb(): MarketingDb {
  marketingDbInstance ??= drizzle(getAppPostgresPool(), {
    schema: marketingSchema,
  });
  return marketingDbInstance;
}
