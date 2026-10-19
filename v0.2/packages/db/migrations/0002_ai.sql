-- T2/T3: AI generation jobs and application batches.
-- Definitions are versioned configuration; records/task instances remain runtime data.
-- The blueprint itself is not stored as user facts: only the validated candidate and ID mapping are recorded.

CREATE TABLE ai_generation_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  operation_id uuid NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','generating','validating','preview_ready','applied','needs_fix','failed','cancelled')),
  mode text NOT NULL CHECK (mode IN ('create','extend')),
  module_id uuid,
  target_base_version integer,
  apply_mode text NOT NULL CHECK (apply_mode IN ('apply','preview')),
  provider text NOT NULL,
  model text NOT NULL,
  request jsonb NOT NULL,
  candidate jsonb,
  validation jsonb NOT NULL DEFAULT '{"valid":false,"errors":[],"warnings":[]}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  finished_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, id),
  UNIQUE(user_id, operation_id),
  FOREIGN KEY(user_id, module_id) REFERENCES modules(user_id, id)
);
CREATE INDEX ai_generation_jobs_user_created ON ai_generation_jobs(user_id, created_at DESC, id);

CREATE TABLE ai_generation_batches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  job_id uuid NOT NULL,
  module_id uuid,
  module_created boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('applied','revoked')),
  base_module_version integer,
  id_map jsonb NOT NULL,
  objects jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_mode text CHECK (revoke_mode IN ('deleted','archived')),
  UNIQUE(user_id, id),
  UNIQUE(user_id, job_id),
  FOREIGN KEY(user_id, job_id) REFERENCES ai_generation_jobs(user_id, id),
  FOREIGN KEY(user_id, module_id) REFERENCES modules(user_id, id) ON DELETE SET NULL (module_id)
);
CREATE INDEX ai_generation_batches_user_created ON ai_generation_batches(user_id, created_at DESC, id);

-- Revoked definitions stay for history/audit but disappear from active configuration lists.
ALTER TABLE metric_definitions ADD COLUMN archived_at timestamptz;
ALTER TABLE achievement_definitions ADD COLUMN archived_at timestamptz;
