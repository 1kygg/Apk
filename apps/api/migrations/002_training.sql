CREATE TABLE IF NOT EXISTS daily_plans (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  environment text NOT NULL CHECK (environment IN ('home','gym','outdoor')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','started','completed')),
  activity_id uuid REFERENCES activities(id) ON DELETE SET NULL,
  started_snapshot jsonb,
  progress jsonb NOT NULL DEFAULT '{"sets":{},"adaptations":{},"notes":""}'::jsonb CHECK (jsonb_typeof(progress) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  completion_payload jsonb CHECK (completion_payload IS NULL OR jsonb_typeof(completion_payload) = 'object'),
  UNIQUE (user_id, local_date, environment),
  CHECK ((status = 'draft' AND started_snapshot IS NULL AND started_at IS NULL) OR
         (status IN ('started','completed') AND started_snapshot IS NOT NULL AND started_at IS NOT NULL)),
  CHECK ((status = 'completed' AND finished_at IS NOT NULL) OR (status <> 'completed' AND finished_at IS NULL))
);
-- A second environment or regenerated suggestion cannot create another session
-- opportunity on the same personal calendar day.
CREATE UNIQUE INDEX IF NOT EXISTS daily_plans_one_started_per_day
  ON daily_plans(user_id, local_date) WHERE status IN ('started','completed');
CREATE INDEX IF NOT EXISTS daily_plans_history ON daily_plans(user_id, local_date DESC);
CREATE TABLE IF NOT EXISTS daily_plan_events (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('substituted','started','progress','completed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION preserve_started_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  redacting_execution boolean := OLD.activity_id IS NOT NULL AND NEW.activity_id IS NULL
    AND NEW.completion_payload IS NULL
    AND NEW.progress = '{"sets":{},"adaptations":{},"notes":""}'::jsonb;
BEGIN
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.local_date <> OLD.local_date OR NEW.environment <> OLD.environment THEN
    RAISE EXCEPTION 'Plan identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.started_snapshot IS NOT NULL AND NEW.started_snapshot IS DISTINCT FROM OLD.started_snapshot THEN
    RAISE EXCEPTION 'Started plan snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND NEW.payload IS DISTINCT FROM OLD.payload THEN
    RAISE EXCEPTION 'Started plan content is immutable; use progress adaptations' USING ERRCODE = '23514';
  END IF;
  IF NOT redacting_execution AND OLD.completion_payload IS NOT NULL AND NEW.completion_payload IS DISTINCT FROM OLD.completion_payload THEN
    RAISE EXCEPTION 'Staged completion is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT redacting_execution AND OLD.completion_payload IS NOT NULL AND NEW.progress IS DISTINCT FROM OLD.progress THEN
    RAISE EXCEPTION 'Staged completion progress is immutable' USING ERRCODE = '23514';
  END IF;
  IF (OLD.status = 'completed' AND NEW.status <> 'completed') OR (OLD.status = 'started' AND NEW.status = 'draft') THEN
    RAISE EXCEPTION 'Plan status cannot move backwards' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS preserve_started_plan_trigger ON daily_plans;
CREATE TRIGGER preserve_started_plan_trigger BEFORE UPDATE ON daily_plans
  FOR EACH ROW EXECUTE FUNCTION preserve_started_plan();
