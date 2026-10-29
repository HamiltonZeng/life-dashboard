-- Stable public identity for schedule receipts and source lookups.
ALTER TABLE report_schedules ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX report_schedules_identity ON report_schedules(user_id,id);
CREATE INDEX ai_usage_parent_day ON ai_usage(user_id,day,parent_id);
