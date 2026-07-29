CREATE TABLE "sealai_assistant"."identity_fingerprints" (
	"cr_name" text PRIMARY KEY NOT NULL,
	"user_uid" text NOT NULL,
	"minted_at" bigint NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
