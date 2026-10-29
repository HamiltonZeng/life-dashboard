-- Additive phase-two domain structures. 0001..0003 are immutable.
ALTER TABLE task_templates ADD COLUMN phase2 boolean NOT NULL DEFAULT false;
ALTER TABLE task_templates ADD COLUMN status text NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','archived'));
ALTER TABLE task_templates ADD COLUMN next_definition jsonb;
ALTER TABLE task_templates ADD COLUMN effective_at timestamptz;
ALTER TABLE task_templates ADD COLUMN schedule_timezone text;
ALTER TABLE task_templates ADD COLUMN generation_cursor timestamptz;
ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK(status IN ('pending','in_progress','partial','completed','skipped','cancelled','ended'));
CREATE TABLE reward_accounts (
 user_id uuid PRIMARY KEY REFERENCES users(id), timezone text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE task_instance_details (
 user_id uuid NOT NULL,task_id uuid NOT NULL,template_id uuid NOT NULL,template_version integer NOT NULL,
 category text NOT NULL CHECK(category IN ('main','daily','weekly','monthly')),
 period_key text NOT NULL,period_start timestamptz NOT NULL,period_end timestamptz,
 snapshot jsonb NOT NULL,progress jsonb NOT NULL DEFAULT '{"value":null,"target":null,"source_record_ids":[],"distinct_dates":[]}',
 reward_policy_version text NOT NULL,reward_candidate bigint NOT NULL CHECK(reward_candidate>=0),
 quota_period text,reward_deadline timestamptz,manual_revoked boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,task_id),UNIQUE(user_id,template_id,period_key),
 FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id),
 FOREIGN KEY(user_id,template_id) REFERENCES task_templates(user_id,id),
 CHECK(period_end IS NULL OR period_end>period_start)
);
CREATE TABLE task_history (
 id uuid PRIMARY KEY,user_id uuid NOT NULL,task_id uuid NOT NULL,version integer NOT NULL,
 event text NOT NULL,reason text,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,task_id,version),FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id)
);
CREATE TABLE achievement_series (
 id uuid PRIMARY KEY,user_id uuid NOT NULL,module_id uuid NOT NULL,record_type_id uuid NOT NULL,
 definition jsonb NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,id),FOREIGN KEY(user_id,module_id,record_type_id) REFERENCES record_types(user_id,module_id,id)
);
CREATE TABLE series_milestones (
 id uuid PRIMARY KEY,user_id uuid NOT NULL,series_id uuid NOT NULL,threshold numeric(30,6) NOT NULL CHECK(threshold>0),
 label text NOT NULL,UNIQUE(user_id,id),UNIQUE(user_id,series_id,threshold),
 FOREIGN KEY(user_id,series_id) REFERENCES achievement_series(user_id,id)
);
CREATE TABLE series_awards (
 id uuid PRIMARY KEY,user_id uuid NOT NULL,series_id uuid NOT NULL,milestone_id uuid NOT NULL,
 period_key text NOT NULL DEFAULT 'all_time',state text NOT NULL CHECK(state IN ('unlocked','needs_review')),
 version integer NOT NULL DEFAULT 1,unlocked_at timestamptz NOT NULL,evaluated_at timestamptz NOT NULL,
 evidence jsonb NOT NULL,original_evidence jsonb NOT NULL,
 UNIQUE(user_id,id),UNIQUE(user_id,series_id,milestone_id,period_key),
 FOREIGN KEY(user_id,series_id) REFERENCES achievement_series(user_id,id),
 FOREIGN KEY(user_id,milestone_id) REFERENCES series_milestones(user_id,id)
);
CREATE TABLE reward_qualifications (
 id uuid PRIMARY KEY,user_id uuid NOT NULL,task_id uuid NOT NULL,category text NOT NULL,quota_period text NOT NULL,
 policy_version text NOT NULL,amount bigint NOT NULL CHECK(amount>=0),eligible boolean NOT NULL,
 denial_reason text CHECK(denial_reason IN ('quota_full','expired')),original_grant_id uuid,
 created_at timestamptz NOT NULL,UNIQUE(user_id,id),UNIQUE(user_id,task_id),
 FOREIGN KEY(user_id,task_id) REFERENCES task_instance_details(user_id,task_id),
 CHECK((eligible AND denial_reason IS NULL) OR (NOT eligible AND denial_reason IS NOT NULL))
);
CREATE INDEX reward_quota_period ON reward_qualifications(user_id,category,quota_period) WHERE eligible;
CREATE TABLE wallet_ledger (
 id uuid PRIMARY KEY,user_id uuid NOT NULL,task_id uuid NOT NULL,qualification_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>0),kind text NOT NULL CHECK(kind IN ('grant','reversal','reinstatement')),
 amount bigint NOT NULL CHECK(amount<>0),policy_version text NOT NULL,root_entry_id uuid NOT NULL,
 previous_entry_id uuid,reason text NOT NULL,created_at timestamptz NOT NULL,
 UNIQUE(user_id,id),UNIQUE(user_id,qualification_id,ordinal),
 FOREIGN KEY(user_id,qualification_id) REFERENCES reward_qualifications(user_id,id),
 FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id),
 FOREIGN KEY(user_id,root_entry_id) REFERENCES wallet_ledger(user_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(user_id,previous_entry_id) REFERENCES wallet_ledger(user_id,id),
 CHECK((kind='reversal' AND amount<0) OR (kind IN ('grant','reinstatement') AND amount>0))
);
CREATE UNIQUE INDEX wallet_one_grant ON wallet_ledger(user_id,qualification_id) WHERE kind='grant';
ALTER TABLE reward_qualifications ADD CONSTRAINT original_grant_reference FOREIGN KEY(user_id,original_grant_id) REFERENCES wallet_ledger(user_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION immutable_wallet_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'wallet ledger is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER wallet_ledger_immutable BEFORE UPDATE OR DELETE ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION immutable_wallet_ledger();
ALTER TABLE profile_fields DROP CONSTRAINT profile_fields_kind_check;
ALTER TABLE profile_fields ADD CONSTRAINT profile_fields_kind_check CHECK(kind IN ('profile','observation','derived'));
ALTER TABLE profile_fields ADD COLUMN binding jsonb;
ALTER TABLE home_preferences ADD COLUMN task_pins jsonb NOT NULL DEFAULT '[]';
ALTER TABLE home_preferences ADD COLUMN pinned_trends jsonb NOT NULL DEFAULT '[]';
