#!/usr/bin/env ts-node

import { Pool } from "pg";
import { spawn } from "child_process";

// Database connection for job polling
const pool = new Pool({
  connectionString: "postgresql://postgres:postgres@localhost:5432/postgres"
});

// Job poller for local development using SAM local
let jobPollerInterval: NodeJS.Timeout | null = null;

async function pollAndProcessJobs() {
  try {
    console.log("🔍 [POLLER] Starting job poll...");
    
    // Query for jobs that need processing (queued or processing)
    const result = await pool.query(
      `SELECT message_id, kind, input FROM jobs 
       WHERE status IN ('queued', 'processing') AND cancelled = false 
       ORDER BY created_at ASC 
       LIMIT 5`
    );
    
    console.log(`🔍 [POLLER] Query result: ${result.rows.length} rows found`);
    if (result.rows.length > 0) {
      console.log(`🔍 [POLLER] Job IDs:`, result.rows.map(r => r.message_id));
    }
    
    if (result.rows.length > 0) {
      console.log(`🔍 [POLLER] Found ${result.rows.length} queued jobs`);
      
      for (const job of result.rows) {
        try {
          // Mark job as processing
          await pool.query(
            `UPDATE jobs SET status = 'processing', updated_at = NOW() WHERE message_id = $1`,
            [job.message_id]
          );
          
          // Process the job using SAM local invoke
          console.log(`🚀 [POLLER] Processing job ${job.message_id} (${job.kind}) with SAM local`);
          await processJobWithSamLocal(job);
          
          console.log(`✅ [POLLER] Job ${job.message_id} completed successfully`);
        } catch (error) {
          console.error(`❌ [POLLER] Failed to process job ${job.message_id}:`, error);
          
          // Mark job as failed
          const errorMessage = error instanceof Error ? error.message : String(error);
          await pool.query(
            `UPDATE jobs SET status = 'failed', output = $1, updated_at = NOW() WHERE message_id = $2`,
            [JSON.stringify({ error: errorMessage }), job.message_id]
          );
        }
      }
    }
  } catch (error) {
    console.error("❌ [POLLER] Error polling jobs:", error);
  }
}

// Process job using SAM local invoke (avoids import issues)
async function processJobWithSamLocal(job: any): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[SAM] Invoking JobProcessorFunction for job ${job.message_id}`);
    
    // Create event payload for the Lambda function
    const event = {
      Records: [{
        messageId: job.message_id,
        body: JSON.stringify({
          messageId: job.message_id,
          kind: job.kind,
          input: job.input
        })
      }]
    };
    
    // Use sam local invoke to run the actual Lambda function
    const samProcess = spawn("sam", [
      "local", "invoke", "JobProcessorFunction",
      "--env-vars", "env-local.json",
      "--event", "-"
    ], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    
    let stdout = "";
    let stderr = "";
    
    samProcess.stdout.on("data", (data) => {
      stdout += data.toString();
      console.log(`[SAM] stdout: ${data.toString().trim()}`);
    });
    
    samProcess.stderr.on("data", (data) => {
      stderr += data.toString();
      console.log(`[SAM] stderr: ${data.toString().trim()}`);
    });
    
    samProcess.on("close", async (code) => {
      console.log(`[SAM] Process exited with code ${code}`);
      
      if (code === 0) {
        try {
          // Parse the response and check if job was processed
          const response = JSON.parse(stdout);
          console.log(`[SAM] Response:`, response);
          
          // Check if job status was updated in the database
          const { rows } = await pool.query(
            `SELECT status, output FROM jobs WHERE message_id = $1`,
            [job.message_id]
          );
          
          if (rows.length > 0) {
            const jobStatus = rows[0];
            console.log(`[SAM] Job ${job.message_id} final status:`, jobStatus.status);
            
            if (jobStatus.status === "completed" || jobStatus.status === "failed") {
              resolve();
            } else {
              reject(new Error(`Job ${job.message_id} still processing after SAM invoke`));
            }
          } else {
            reject(new Error(`Job ${job.message_id} not found after SAM invoke`));
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse SAM response: ${parseError}`));
        }
      } else {
        reject(new Error(`SAM local invoke failed with code ${code}: ${stderr}`));
      }
    });
    
    samProcess.on("error", (error) => {
      reject(new Error(`Failed to spawn SAM process: ${error.message}`));
    });
    
    // Send the event to SAM
    samProcess.stdin.write(JSON.stringify(event));
    samProcess.stdin.end();
  });
}

function startJobPoller() {
  if (jobPollerInterval) {
    clearInterval(jobPollerInterval);
  }
  
  console.log("🚀 [POLLER] Starting SAM-based job poller (every 1 seconds)");
  jobPollerInterval = setInterval(() => {
    console.log("⏰ [POLLER] Interval triggered, calling pollAndProcessJobs...");
    pollAndProcessJobs();
  }, 1000);
  
  // Process jobs immediately on startup
  console.log("🚀 [POLLER] Running initial job poll...");
  pollAndProcessJobs();
}

function stopJobPoller() {
  if (jobPollerInterval) {
    clearInterval(jobPollerInterval);
    jobPollerInterval = null;
    console.log("🛑 [POLLER] Job poller stopped");
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down job poller...");
  stopJobPoller();
  pool.end();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down job poller...");
  stopJobPoller();
  pool.end();
  process.exit(0);
});

// Start the job poller
console.log("🚀 Starting SAM-based local job poller...");
startJobPoller();
