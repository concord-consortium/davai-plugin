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

    // Create any other tables that LangGraph might need
    // (These will be created automatically by LangGraph, but we can pre-create them)
    
    console.log("Database setup completed successfully");
  } catch (error) {
    console.error("Error during database setup:", error);
    throw error;
  } finally {
    await pool.end();
  }
};
