import { Pool } from "pg";

export const handler = async (): Promise<void> => {
  console.log("Starting database setup...");
  
  // Create a fresh pool for each invocation
  const pool = new Pool({
    connectionString: process.env.POSTGRES_CONNECTION_STRING
  });
  
  try {
    // Create jobs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        message_id VARCHAR(255) UNIQUE NOT NULL,
        kind VARCHAR(50) NOT NULL,
        input JSONB NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        output JSONB,
        cancelled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("Jobs table created/verified successfully");

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_message_id ON jobs (message_id);
    `);
    console.log("Index idx_jobs_message_id created/verified successfully");

    // Create the notification function
    await pool.query(`
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
    `);
    console.log("Function notify_job_cancelled created/verified successfully");

    // Create the trigger
    await pool.query(`
      DROP TRIGGER IF EXISTS job_cancelled_trigger ON jobs;
      CREATE TRIGGER job_cancelled_trigger
        AFTER UPDATE ON jobs
        FOR EACH ROW
        EXECUTE FUNCTION notify_job_cancelled();
    `);
    console.log("Trigger job_cancelled_trigger created/verified successfully");

    // Add timestamp columns to checkpoints table
    await pool.query(`
      ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
    `);
    await pool.query(`
      ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
    `);
    console.log("Timestamp columns added to checkpoints table if not present");

    // Create or replace update_timestamps_trigger function
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_timestamps_trigger()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log("Function update_timestamps_trigger created/verified successfully");

    // Create the trigger for checkpoints table
    await pool.query(`
      DROP TRIGGER IF EXISTS set_checkpoints_timestamp ON checkpoints;
      CREATE TRIGGER set_checkpoints_timestamp
      BEFORE UPDATE ON checkpoints
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamps_trigger();
    `);
    console.log("Trigger set_checkpoints_timestamp created/verified successfully");
    
    console.log("Database setup completed successfully");
  } catch (error) {
    console.error("Error during database setup:", error);
    throw error;
  } finally {
    await pool.end();
  }
};
