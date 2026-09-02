import { eq, or } from "drizzle-orm";

import type { AssistantPgTransaction } from "@/features/chat/persistence/db";
import { identityUidCanonicalizations } from "@/features/chat/persistence/schema";

type CanonicalIdentityReadTransaction = Pick<
  AssistantPgTransaction,
  "insert" | "select"
>;

type CanonicalIdentityWriteTransaction = Pick<
  AssistantPgTransaction,
  "insert" | "update"
>;

/**
 * Locks the UID redirect through commit so a concurrent merge either sweeps
 * this write afterward or publishes its survivor before this read.
 */
export async function canonicalIdentityUid(
  tx: CanonicalIdentityReadTransaction,
  userUidRaw: string
): Promise<string> {
  const userUid = userUidRaw.trim();
  if (userUid === "") {
    throw new Error("A verified user UID is required.");
  }
  await tx
    .insert(identityUidCanonicalizations)
    .values({ canonicalUserUid: userUid, userUid })
    .onConflictDoNothing({ target: identityUidCanonicalizations.userUid });
  const [row] = await tx
    .select({
      canonicalUserUid: identityUidCanonicalizations.canonicalUserUid,
    })
    .from(identityUidCanonicalizations)
    .where(eq(identityUidCanonicalizations.userUid, userUid))
    .for("share");
  if (row == null) {
    throw new Error("Canonical identity row disappeared mid-transaction.");
  }
  return row.canonicalUserUid;
}

/** Redirects the tombstone and every earlier alias to the newest survivor. */
export async function rekeyCanonicalIdentityUids(
  tx: CanonicalIdentityWriteTransaction,
  input: { survivorUserUid: string; tombstoneUserUid: string }
): Promise<number> {
  const userUids = [input.survivorUserUid, input.tombstoneUserUid].sort();
  await tx
    .insert(identityUidCanonicalizations)
    .values(userUids.map((userUid) => ({ canonicalUserUid: userUid, userUid })))
    .onConflictDoNothing({ target: identityUidCanonicalizations.userUid });
  const rekeyed = await tx
    .update(identityUidCanonicalizations)
    .set({ canonicalUserUid: input.survivorUserUid })
    .where(
      or(
        eq(
          identityUidCanonicalizations.canonicalUserUid,
          input.tombstoneUserUid
        ),
        eq(identityUidCanonicalizations.userUid, input.tombstoneUserUid)
      )
    )
    .returning({ userUid: identityUidCanonicalizations.userUid });
  return rekeyed.length;
}
