ALTER TABLE record_types ADD COLUMN archived_at timestamptz;
ALTER TABLE achievement_series ADD COLUMN archived_at timestamptz;
CREATE TABLE ai_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 automatic_mode text NOT NULL DEFAULT 'clear_commands', readable_module_ids jsonb NOT NULL DEFAULT '[]',
 auto_config_objects_limit integer NOT NULL DEFAULT 12, auto_record_count_limit integer NOT NULL DEFAULT 5
);
CREATE TABLE ai_conversations (
 user_id uuid NOT NULL REFERENCES users(id), id uuid NOT NULL, version integer NOT NULL DEFAULT 1,
 entrypoint text NOT NULL,title text,created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,id)
);
CREATE TABLE ai_messages (
 user_id uuid NOT NULL,id uuid NOT NULL,conversation_id uuid NOT NULL,client_message_id uuid NOT NULL,
 seq bigint GENERATED ALWAYS AS IDENTITY,body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id), UNIQUE(user_id,conversation_id,client_message_id),
 FOREIGN KEY(user_id,conversation_id) REFERENCES ai_conversations(user_id,id) ON DELETE CASCADE
);
CREATE TABLE ai_runs (
 user_id uuid NOT NULL,id uuid NOT NULL,conversation_id uuid NOT NULL,message_id uuid NOT NULL,operation_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued',version integer NOT NULL DEFAULT 1,attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz,lease_owner uuid,cancel_requested boolean NOT NULL DEFAULT false,
 received_at timestamptz NOT NULL DEFAULT now(),deadline_at timestamptz, detail jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(user_id,id),UNIQUE(user_id,message_id),
 FOREIGN KEY(user_id,message_id) REFERENCES ai_messages(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,conversation_id) REFERENCES ai_conversations(user_id,id) ON DELETE CASCADE
);
CREATE INDEX ai_runs_queue ON ai_runs(status,received_at);
CREATE TABLE ai_run_events (
 user_id uuid NOT NULL,run_id uuid NOT NULL,event_id bigint GENERATED ALWAYS AS IDENTITY,kind text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,event_id),FOREIGN KEY(user_id,run_id) REFERENCES ai_runs(user_id,id) ON DELETE CASCADE
);
CREATE TABLE ai_context_snapshots (
 user_id uuid NOT NULL,id uuid NOT NULL,run_id uuid NOT NULL,context jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),FOREIGN KEY(user_id,run_id) REFERENCES ai_runs(user_id,id) ON DELETE CASCADE
);
CREATE TABLE ai_proposals (
 user_id uuid NOT NULL,id uuid NOT NULL,run_id uuid NOT NULL,version integer NOT NULL DEFAULT 1,status text NOT NULL,
 content_hash text NOT NULL,decision jsonb NOT NULL,compiled jsonb NOT NULL,context_id uuid NOT NULL,
 confirmation_required boolean NOT NULL,token_hash text,expires_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,id),UNIQUE(user_id,run_id),
 FOREIGN KEY(user_id,run_id) REFERENCES ai_runs(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,context_id) REFERENCES ai_context_snapshots(user_id,id)
);
CREATE TABLE goals (
 user_id uuid NOT NULL REFERENCES users(id),id uuid NOT NULL,module_id uuid NOT NULL,version integer NOT NULL DEFAULT 1,
 definition jsonb NOT NULL,source_message_id uuid,archived_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),FOREIGN KEY(user_id,module_id) REFERENCES modules(user_id,id)
);
CREATE TABLE goal_revisions (
 user_id uuid NOT NULL,goal_id uuid NOT NULL,version integer NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,goal_id,version),FOREIGN KEY(user_id,goal_id) REFERENCES goals(user_id,id) ON DELETE CASCADE
);
CREATE TABLE plan_versions (
 user_id uuid NOT NULL,id uuid NOT NULL,goal_id uuid NOT NULL,source_run_id uuid NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),FOREIGN KEY(user_id,goal_id) REFERENCES goals(user_id,id),FOREIGN KEY(user_id,source_run_id) REFERENCES ai_runs(user_id,id)
);
CREATE TABLE plan_objects (
 user_id uuid NOT NULL,plan_id uuid NOT NULL,entity_type text NOT NULL,entity_id uuid NOT NULL,reused boolean NOT NULL,
 PRIMARY KEY(user_id,plan_id,entity_type,entity_id),FOREIGN KEY(user_id,plan_id) REFERENCES plan_versions(user_id,id)
);
CREATE TABLE ai_applications (
 user_id uuid NOT NULL,id uuid NOT NULL,proposal_id uuid NOT NULL,receipt jsonb NOT NULL,created_objects jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1,undo_hash text,undo_expires_at timestamptz,undo_preview jsonb,undone_at timestamptz,
 PRIMARY KEY(user_id,id),UNIQUE(user_id,proposal_id),FOREIGN KEY(user_id,proposal_id) REFERENCES ai_proposals(user_id,id)
);
CREATE TABLE ai_usage (
 user_id uuid NOT NULL,run_id uuid NOT NULL,attempt integer NOT NULL,day date NOT NULL,
 reserved_input integer NOT NULL,reserved_output integer NOT NULL,input_tokens integer,output_tokens integer,
 status text NOT NULL DEFAULT 'reserved',provider text NOT NULL,model text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,run_id,attempt),FOREIGN KEY(user_id,run_id) REFERENCES ai_runs(user_id,id) ON DELETE CASCADE
);
