-- Create the jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(255) UNIQUE NOT NULL,
    kind VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'queued',
    input JSONB NOT NULL,
    output JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cancelled BOOLEAN DEFAULT FALSE
);

-- Create the notification function and trigger
CREATE OR REPLACE FUNCTION notify_job_cancelled()
RETURNS trigger AS $$
BEGIN
    IF OLD.cancelled = FALSE AND NEW.cancelled = TRUE THEN
        PERFORM pg_notify('job_cancelled', json_build_object('messageId', NEW.message_id)::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_cancelled_trigger
    AFTER UPDATE ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_job_cancelled();
