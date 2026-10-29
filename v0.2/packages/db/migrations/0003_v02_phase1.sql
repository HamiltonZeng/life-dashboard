-- Additive migration: existing facts, definitions and receipts are untouched.
CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  bio text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_fields (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, module_id uuid NOT NULL,
  key text NOT NULL, label text NOT NULL, type text NOT NULL,
  kind text NOT NULL DEFAULT 'profile' CHECK(kind='profile'),
  value jsonb NOT NULL, unit text, options jsonb NOT NULL DEFAULT '[]',
  UNIQUE(user_id,module_id,key),
  FOREIGN KEY(user_id) REFERENCES user_profiles(user_id),
  FOREIGN KEY(user_id,module_id) REFERENCES modules(user_id,id)
);
CREATE TABLE home_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  minimal_mode boolean NOT NULL DEFAULT false,
  pinned_metric_ids jsonb NOT NULL DEFAULT '[]',
  pinned_task_ids jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE configuration_revisions (
  user_id uuid NOT NULL REFERENCES users(id),
  entity_type text NOT NULL CHECK(entity_type IN ('profile','home_preferences')),
  version integer NOT NULL CHECK(version > 0),snapshot jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,entity_type,version)
);
