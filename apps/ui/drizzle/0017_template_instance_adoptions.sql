CREATE TABLE "sealai_project"."template_instance_adoptions" (
	"namespace" text NOT NULL,
	"instance_uid" text NOT NULL,
	"instance_name" text NOT NULL,
	"project_id" text NOT NULL,
	"template_name" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"labeled_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_instance_adoptions_pk" PRIMARY KEY("namespace","instance_uid"),
	CONSTRAINT "template_instance_adoptions_status_valid" CHECK ("sealai_project"."template_instance_adoptions"."status" IN ('adopting', 'adopted', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "template_instance_adoptions_namespace_project_id_idx" ON "sealai_project"."template_instance_adoptions" USING btree ("namespace","project_id");