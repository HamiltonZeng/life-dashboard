-- Phase two: source revisions, durable read jobs, independent schedules and derived memory.
ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_user_id_run_id_fkey;
ALTER TABLE ai_usage ADD FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ai_usage ADD COLUMN purpose text NOT NULL DEFAULT 'plan';
ALTER TABLE ai_usage ADD COLUMN parent_id uuid;
ALTER TABLE ai_usage ADD COLUMN schema_version text NOT NULL DEFAULT 'ai-decision/1.0';
ALTER TABLE ai_usage ADD COLUMN prompt_version text NOT NULL DEFAULT 'v03-p2.1';
CREATE TABLE record_sources (
 user_id uuid NOT NULL,record_id uuid NOT NULL,version integer NOT NULL,
 provenance jsonb NOT NULL,estimated_values jsonb NOT NULL DEFAULT '[]',
 time_precision text NOT NULL CHECK(time_precision IN ('instant','day','approximate')),
 time_basis text NOT NULL,source_run_id uuid,received_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,record_id,version),FOREIGN KEY(user_id,record_id) REFERENCES records(user_id,id) ON DELETE CASCADE
);
CREATE TABLE reward_quotes (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,template_id uuid NOT NULL,template_version integer NOT NULL,
 rule_hash text NOT NULL,category text NOT NULL,amount integer NOT NULL CHECK(amount>0),source text NOT NULL CHECK(source IN ('ai','system_fallback')),
 rationale text NOT NULL,parent_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,template_id,template_version)
);
CREATE TABLE reports (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,id uuid NOT NULL,identity_hash text NOT NULL,
 kind text NOT NULL,request jsonb NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),UNIQUE(user_id,identity_hash)
);
CREATE TABLE report_revisions (
 user_id uuid NOT NULL,report_id uuid NOT NULL,revision integer NOT NULL,status text NOT NULL,
 facts jsonb NOT NULL,narrative jsonb,error jsonb,model text,prompt_version text NOT NULL DEFAULT 'v03-p2.1',
 outdated boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz,
 PRIMARY KEY(user_id,report_id,revision),FOREIGN KEY(user_id,report_id) REFERENCES reports(user_id,id) ON DELETE CASCADE
);
CREATE TABLE report_schedules (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind text NOT NULL,version integer NOT NULL DEFAULT 1,
 config jsonb NOT NULL,next_run_at timestamptz,last_due_key text,pause_reason text,preview_hash text,preview_body_hash text,preview_expires_at timestamptz,
 PRIMARY KEY(user_id,kind)
);
CREATE TABLE report_jobs (
 user_id uuid NOT NULL,id uuid NOT NULL,report_id uuid NOT NULL,revision integer NOT NULL,parent_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued',attempts integer NOT NULL DEFAULT 0,lease_owner uuid,lease_until timestamptz,
 schedule_kind text,schedule_version integer,logical_due_key text,cancel_requested boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,id),UNIQUE(user_id,report_id,revision),
 FOREIGN KEY(user_id,report_id,revision) REFERENCES report_revisions(user_id,report_id,revision) ON DELETE CASCADE
);
CREATE UNIQUE INDEX report_schedule_due_unique ON report_jobs(user_id,schedule_kind,logical_due_key) WHERE schedule_kind IS NOT NULL;
CREATE INDEX report_jobs_queue ON report_jobs(status,created_at);
CREATE TABLE daily_statistics (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,module_id uuid NOT NULL,day date NOT NULL,
 source_hash text NOT NULL,statistics jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,module_id,day)
);
CREATE TABLE report_summaries (
 user_id uuid NOT NULL,report_id uuid NOT NULL,revision integer NOT NULL,module_ids jsonb NOT NULL,
 source_hash text NOT NULL,summary text NOT NULL,outdated boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,report_id,revision),FOREIGN KEY(user_id,report_id,revision) REFERENCES report_revisions(user_id,report_id,revision) ON DELETE CASCADE
);
