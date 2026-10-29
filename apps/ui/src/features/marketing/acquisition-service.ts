import "server-only";

import { sql } from "drizzle-orm";

import { canonicalIdentityUid } from "@/lib/identity-uid-canonicalization";
import { fetchAccountAcquisition } from "./acquisition-client";
import { normalizeMarketingAttribution } from "./consent";
import { getMarketingDb, type MarketingPgDatabase } from "./db";

/** The authentication service owns identity linkage; Brain stores its verified source projection. */
export async function syncAccountAcquisition(
  subjectId: string,
  options: {
    getDb?: () => MarketingPgDatabase;
    lookup?: typeof fetchAccountAcquisition;
  } = {}
): Promise<"linked" | "unmatched"> {
  const linked = await (options.lookup ?? fetchAccountAcquisition)(subjectId);
  if (linked == null) {
    return "unmatched";
  }
  const normalized = await normalizeMarketingAttribution(
    linked.snapshot,
    subjectId
  );
  if (normalized?.consent_provenance == null) {
    throw new Error(
      "Marketing acquisition has no verified account provenance."
    );
  }
  await (options.getDb ?? getMarketingDb)().transaction(async (tx) => {
    const uid = await canonicalIdentityUid(tx, subjectId);
    const attribution = {
      ...normalized,
      consent_provenance: { ...normalized.consent_provenance, subject_id: uid },
    };
    await tx.execute(sql`
      SELECT "sealai_marketing"."upsert_attribution_subject"(
        'user', ${uid}, ${JSON.stringify(attribution)}::jsonb
      )
    `);
  });
  return "linked";
}
