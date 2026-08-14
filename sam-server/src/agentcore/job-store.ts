// In-process replacement for the three pieces of AWS infrastructure the handlers
// used to reach for: the `jobs` Postgres table, the SQS queue, and the
// LISTEN/NOTIFY `job_cancelled` channel.
//
// This works on AgentCore because the runtime pins every request carrying the same
// runtimeSessionId to the same microVM, so the submit / poll / cancel calls of one
// turn all land on this process. The functions below preserve the exact write
// guards the SQL used (see sam-server/database-setup.sql), because those guards are
// what keep a late completion from clobbering a cancel.

import { Job, MessageJobInput, ToolJobInput } from "../types";

// How long a finished job stays readable by /status polls before it is swept. The
// old jobs table kept rows indefinitely; a long-lived microVM needs a bound.
const JOB_TTL_MS = 10 * 60 * 1000;

const jobs = new Map<string, Job>();

// Replaces the `runningJobs` map + LISTEN/NOTIFY hop in job-processor.ts: a cancel
// now aborts the in-flight turn by calling straight into this process.
const running = new Map<string, { abort: () => void }>();

// Set by the AgentCore entrypoint (agentcore/server.ts) to job-processor's
// processJob. Indirection avoids a job-store <-> job-processor import cycle.
let jobRunner: ((messageId: string) => Promise<void>) | undefined;

export const setJobRunner = (fn: (messageId: string) => Promise<void>) => {
  jobRunner = fn;
};

const sweep = () => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [messageId, job] of jobs) {
    if (Date.parse(job.updated_at) < cutoff) jobs.delete(messageId);
  }
};

// INSERT INTO jobs (...) VALUES (...)
export const insertJob = (
  messageId: string,
  kind: "message" | "tool",
  input: MessageJobInput | ToolJobInput
): void => {
  sweep();
  const now = new Date().toISOString();
  jobs.set(messageId, {
    message_id: messageId,
    kind,
    status: "queued",
    input,
    created_at: now,
    updated_at: now,
    cancelled: false,
  } as Job);
};

// SELECT * FROM jobs WHERE message_id = $1
export const getJob = (messageId: string): Job | undefined => jobs.get(messageId);

const update = (messageId: string, changes: Partial<Job>): void => {
  const job = jobs.get(messageId);
  if (!job) return;
  Object.assign(job, changes, { updated_at: new Date().toISOString() });
};

// UPDATE jobs SET status='streaming', output=$1 WHERE message_id=$2 AND cancelled=false
export const writeStreaming = (messageId: string, output: any): void => {
  if (jobs.get(messageId)?.cancelled) return;
  update(messageId, { status: "streaming", output });
};

// UPDATE jobs SET status='completed', output=$1 WHERE message_id=$2 AND cancelled=false
export const writeCompleted = (messageId: string, output: any): void => {
  if (jobs.get(messageId)?.cancelled) return;
  update(messageId, { status: "completed", output });
};

// UPDATE jobs SET status='cancelled' WHERE message_id=$1 AND status <> 'completed'
export const writeCancelled = (messageId: string): void => {
  if (jobs.get(messageId)?.status === "completed") return;
  update(messageId, { status: "cancelled" });
};

// UPDATE jobs SET status='error', output=$2 WHERE message_id=$3  (unguarded, as before)
export const writeError = (messageId: string, message: string): void => {
  update(messageId, { status: "error", output: { error: message } });
};

// cancel.ts's UPDATE + the pg trigger's pg_notify, collapsed into one call.
export const requestCancel = (messageId: string): void => {
  update(messageId, { status: "cancelled", cancelled: true });
  const inFlight = running.get(messageId);
  if (inFlight) {
    console.log(`[CANCEL] Aborting running job ${messageId}`);
    inFlight.abort();
    running.delete(messageId);
  }
};

export const registerRunning = (messageId: string, abort: () => void): void => {
  running.set(messageId, { abort });
};

export const clearRunning = (messageId: string): void => {
  running.delete(messageId);
};

// Replaces `sqs.send(new SendMessageCommand(...))`. Same fire-and-forget shape: the
// submit handler returns 202 immediately and the turn runs in the background, with
// its result reaching the client through the /status poll exactly as before.
export const enqueueJob = (messageId: string): void => {
  if (!jobRunner) throw new Error("job runner not configured");
  void jobRunner(messageId).catch((error) => {
    console.error(`Unhandled error running job ${messageId}:`, error);
  });
};
