-- Create the jobs table
CREATE TABLE jobs (
  message_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  input JSONB NOT NULL,
  output JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cancelled BOOLEAN DEFAULT FALSE
);

-- Create index for better performance
CREATE INDEX idx_jobs_thread_id ON jobs USING GIN ((input->>'threadId'));
CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_jobs_created_at ON jobs (created_at);

-- Create the notification function
CREATE OR REPLACE FUNCTION notify_job_cancelled()
RETURNS trigger AS $$
BEGIN
  IF NEW.cancelled = true AND (OLD.cancelled IS DISTINCT FROM NEW.cancelled) THEN
    PERFORM pg_notify(
      'job_cancelled',
      json_build_object('messageId', NEW.message_id)::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS job_cancelled_trigger ON jobs;
CREATE TRIGGER job_cancelled_trigger
AFTER UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION notify_job_cancelled();

-- Add timestamp columns to checkpoints table
ALTER TABLE checkpoints ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE checkpoints ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION update_timestamps_trigger()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER set_checkpoints_timestamp BEFORE UPDATE ON checkpoints FOR EACH ROW EXECUTE FUNCTION update_timestamps_trigger();
