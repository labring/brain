DROP INDEX "sealai_project"."projects_namespace_display_name_idx";--> statement-breakpoint
-- Case-variant names could coexist under the dropped case-sensitive index, and
-- the functional index below would fail to build on such data. De-duplicate
-- first, deterministically: the earliest Project keeps the name, every later
-- one takes the lowest free incrementing suffix (ADR 0058).
DO $$
DECLARE
  duplicate_row RECORD;
  candidate text;
  suffix int;
BEGIN
  FOR duplicate_row IN
    SELECT ranked."namespace", ranked."id", ranked."display_name"
    FROM (
      SELECT
        "namespace",
        "id",
        "display_name",
        row_number() OVER (
          PARTITION BY "namespace", lower("display_name")
          ORDER BY "created_at", "id"
        ) AS dupe_rank
      FROM "sealai_project"."projects"
    ) AS ranked
    WHERE ranked.dupe_rank > 1
    ORDER BY ranked."namespace", lower(ranked."display_name"), ranked.dupe_rank
  LOOP
    suffix := 2;
    LOOP
      candidate := duplicate_row."display_name" || '-' || suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM "sealai_project"."projects" AS existing
        WHERE existing."namespace" = duplicate_row."namespace"
          AND lower(existing."display_name") = lower(candidate)
      );
      suffix := suffix + 1;
    END LOOP;
    UPDATE "sealai_project"."projects"
    SET "display_name" = candidate
    WHERE "namespace" = duplicate_row."namespace"
      AND "id" = duplicate_row."id";
  END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_namespace_lower_display_name_idx" ON "sealai_project"."projects" USING btree ("namespace",lower("display_name"));