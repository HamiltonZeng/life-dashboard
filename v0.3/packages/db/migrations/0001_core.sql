CREATE TABLE users (
  id uuid PRIMARY KEY, name text NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE modules (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
  description text NOT NULL DEFAULT '', icon text NOT NULL, color text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','disabled','archived')),
  source text NOT NULL DEFAULT 'manual', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id)
);
CREATE TABLE record_types (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, module_id uuid NOT NULL, name text NOT NULL,
  fields jsonb NOT NULL, schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id), UNIQUE(user_id,module_id,id),
  FOREIGN KEY(user_id,module_id) REFERENCES modules(user_id,id)
);
CREATE TABLE task_templates (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, module_id uuid NOT NULL,
  definition jsonb NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id), FOREIGN KEY(user_id,module_id) REFERENCES modules(user_id,id)
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, module_id uuid NOT NULL,
  template_id uuid NOT NULL, rule_version integer NOT NULL DEFAULT 1, definition jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','partial','completed','skipped','cancelled')),
  needs_review boolean NOT NULL DEFAULT false, completed_at timestamptz, completion_origin text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id), FOREIGN KEY(user_id,module_id) REFERENCES modules(user_id,id),
  FOREIGN KEY(user_id,template_id) REFERENCES task_templates(user_id,id)
);
CREATE TABLE metric_definitions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, module_id uuid NOT NULL, record_type_id uuid NOT NULL,
  definition jsonb NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id), FOREIGN KEY(user_id,module_id,record_type_id) REFERENCES record_types(user_id,module_id,id)
);
CREATE TABLE achievement_definitions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, module_id uuid NOT NULL, metric_id uuid NOT NULL,
  definition jsonb NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id), FOREIGN KEY(user_id,module_id) REFERENCES modules(user_id,id),
  FOREIGN KEY(user_id,metric_id) REFERENCES metric_definitions(user_id,id)
);
CREATE TABLE records (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, module_id uuid NOT NULL, record_type_id uuid NOT NULL,
  schema_version integer NOT NULL, occurred_at timestamptz NOT NULL, timezone text NOT NULL,
  status text NOT NULL CHECK(status IN ('draft','confirmed')), values jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE(user_id,id), FOREIGN KEY(user_id,module_id,record_type_id) REFERENCES record_types(user_id,module_id,id)
);
CREATE INDEX records_user_time ON records(user_id,occurred_at,id) WHERE deleted_at IS NULL;
CREATE TABLE record_tasks (
  user_id uuid NOT NULL, record_id uuid NOT NULL, task_id uuid NOT NULL,
  PRIMARY KEY(user_id,record_id,task_id),
  FOREIGN KEY(user_id,record_id) REFERENCES records(user_id,id), FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id)
);
CREATE TABLE record_revisions (
  user_id uuid NOT NULL, record_id uuid NOT NULL, version integer NOT NULL, snapshot jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,record_id,version),
  FOREIGN KEY(user_id,record_id) REFERENCES records(user_id,id)
);
CREATE TABLE achievement_awards (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, achievement_id uuid NOT NULL, rule_version integer NOT NULL,
  period_key text NOT NULL DEFAULT 'once', state text NOT NULL CHECK(state IN ('unlocked','needs_review')),
  unlocked_at timestamptz NOT NULL DEFAULT now(), evaluated_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL, original_evidence jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
  UNIQUE(user_id,achievement_id,period_key), FOREIGN KEY(user_id,achievement_id) REFERENCES achievement_definitions(user_id,id)
);
CREATE TABLE user_sync_clock (user_id uuid PRIMARY KEY REFERENCES users(id), seq bigint NOT NULL DEFAULT 0);
CREATE TABLE change_log (
  user_id uuid NOT NULL REFERENCES users(id), seq bigint NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL,
  version integer NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,seq)
);
CREATE TABLE mutation_receipts (
  user_id uuid NOT NULL REFERENCES users(id), operation_id uuid NOT NULL, request_hash text NOT NULL,
  response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,operation_id)
);
