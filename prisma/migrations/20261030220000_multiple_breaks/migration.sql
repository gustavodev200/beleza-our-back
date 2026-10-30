-- Várias pausas por dia: break_start/break_end viram a lista JSON "breaks"
ALTER TABLE "business_hours" ADD COLUMN "breaks" JSONB NOT NULL DEFAULT '[]';

UPDATE "business_hours"
SET "breaks" = jsonb_build_array(jsonb_build_object('start', "break_start", 'end', "break_end"))
WHERE "break_start" IS NOT NULL AND "break_end" IS NOT NULL;

ALTER TABLE "business_hours" DROP COLUMN "break_start",
DROP COLUMN "break_end";
