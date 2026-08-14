CREATE TABLE "sealai_assistant"."identity_uid_canonicalizations" (
	"user_uid" text PRIMARY KEY NOT NULL,
	"canonical_user_uid" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "identity_uid_canonicalizations_canonical_idx" ON "sealai_assistant"."identity_uid_canonicalizations" USING btree ("canonical_user_uid");
