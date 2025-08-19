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

DROP TRIGGER IF EXISTS job_cancelled_trigger ON jobs;

CREATE TRIGGER job_cancelled_trigger
AFTER UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION notify_job_cancelled();