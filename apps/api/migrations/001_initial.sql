CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text UNIQUE,
  apple_sub text UNIQUE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  avatar_url text CHECK (char_length(avatar_url) <= 450000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (google_sub IS NOT NULL OR apple_sub IS NOT NULL)
);
CREATE TABLE refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  replaced_by uuid REFERENCES refresh_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX refresh_family_idx ON refresh_sessions(family_id);
CREATE TABLE apple_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '10 minutes'),
  used_at timestamptz
);
CREATE TABLE user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  notification_settings jsonb NOT NULL DEFAULT '{"enabled":false,"days":[],"hour":18,"minute":0,"quietStartMinute":1320,"quietEndMinute":420}',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin','member')),
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (group_id,user_id)
);
CREATE INDEX group_members_user_idx ON group_members(user_id);
CREATE TABLE group_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 3000),
  rules jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ranking_updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX challenges_group_idx ON challenges(group_id);
CREATE TABLE challenge_change_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  rules jsonb NOT NULL,
  token_hash text NOT NULL UNIQUE,
  reason text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '10 minutes')
);
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  modality text NOT NULL CHECK (modality IN ('strength','walking','running','cycling','football','basketball','volleyball')),
  source text NOT NULL CHECK (source IN ('self_reported','gps','manual','health_connect','healthkit')),
  environment text NOT NULL CHECK (environment IN ('home','gym','outdoor')),
  plan_id uuid,
  status text NOT NULL CHECK (status IN ('started','completed')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  recorded_start_at timestamptz,
  recorded_end_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  server_started boolean NOT NULL,
  active_seconds integer NOT NULL DEFAULT 0 CHECK (active_seconds BETWEEN 0 AND 604800),
  distance_meters double precision CHECK (distance_meters >= 0 AND distance_meters <= 2000000),
  steps integer CHECK (steps BETWEEN 0 AND 1000000),
  source_record_id text CHECK (char_length(source_record_id) <= 250),
  eligibility text NOT NULL CHECK (eligibility IN ('verified','pending_review','ineligible')),
  ineligible_reason text,
  completion_fingerprint text,
  notes text CHECK (char_length(notes) <= 2000),
  adaptations text CHECK (char_length(adaptations) <= 2000),
  warnings jsonb NOT NULL DEFAULT '[]',
  UNIQUE(user_id,client_id),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (recorded_end_at IS NULL OR recorded_end_at >= recorded_start_at),
  CHECK (modality <> 'cycling' OR steps IS NULL)
);
CREATE UNIQUE INDEX activity_import_identity ON activities(user_id,source,source_record_id) WHERE source_record_id IS NOT NULL;
CREATE INDEX activities_user_started_idx ON activities(user_id,started_at DESC);
CREATE TABLE activity_reviews (
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 1000),
  corrected_start_at timestamptz,
  corrected_end_at timestamptz,
  corrected_distance_meters double precision CHECK (corrected_distance_meters >= 0 AND corrected_distance_meters <= 2000000),
  corrected_active_seconds integer CHECK (corrected_active_seconds BETWEEN 0 AND 604800),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (challenge_id,activity_id)
);
CREATE TABLE challenge_scores (
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total double precision NOT NULL DEFAULT 0,
  weeks_met integer NOT NULL DEFAULT 0,
  credits jsonb NOT NULL DEFAULT '[]',
  weeks jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(challenge_id,user_id)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE,
  challenge_id uuid REFERENCES challenges(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  reason text,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE,
  challenge_id uuid REFERENCES challenges(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE consistency_credits (
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  value double precision NOT NULL,
  PRIMARY KEY(challenge_id,user_id,local_date)
);
