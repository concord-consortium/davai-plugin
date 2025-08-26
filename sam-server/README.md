# Davai Plugin Server - SAM Version

This is the AWS SAM version of the Davai server, converted from the Express-based server.

## Prerequisites

1. Install AWS SAM CLI: `brew install aws-sam-cli` (macOS)
2. Install Node.js dependencies: `npm install`
3. Copy `env.example` to `.env` and add values:

- Database connection string
- API secrets
- LLM API keys

## Deployment

```bash
npm run sam:build
npm run sam:deploy
```

### Local Testing

```bash
npm run sam:local
```

## Database Setup

After the first deployment, connect to your RDS instance and run:
```bash
psql -h <rds-endpoint> -U postgres -d postgres -f database-setup.sql
```

Alternatively, you can trigger the deployed setup Lambda function with:
```bash
aws lambda invoke \
  --function-name <deployed-davai-server-setup-function> \
  output.json
```

You can find the deployed function name in the AWS console or by running:
```bash
aws lambda list-functions
```

## Architecture

- **API Gateway**: Handles HTTP requests
- **Lambda Functions**: Process API requests and jobs
- **RDS PostgreSQL**: Stores jobs and LangGraph checkpoints
- **SQS**: Queues jobs for processing

## API Endpoints

- **`POST /default/davaiServer/message`** - Create message jobs
- **`POST /default/davaiServer/tool`** - Create tool jobs
- **`GET /default/davaiServer/status?messageId=X`** - Check job status
- **`POST /default/davaiServer/cancel`** - Cancel jobs

## Job Cancellation

### Overview
When a user cancels a message before the LLM responds, the system coordinates cancellation across multiple components to ensure proper cleanup and state management. The cancellation workflow involves the client app, API endpoints, database triggers, and the job processor.

### Architecture Components
- **Client App**: Sends cancellation request via the cancel endpoint
- **Cancel Handler**: Updates job status in database and triggers PostgreSQL notifications
- **Database Triggers**: Automatically notify running jobs of cancellation via PostgreSQL LISTEN/NOTIFY
- **Job Processor**: Listens for cancellation signals and aborts running LLM operations
- **PostgreSQL**: Manages job state and provides real-time notification system

### Database Setup
The setup function creates several database objects to support cancellation:

1. **Jobs Table**: Stores job state including `cancelled` boolean flag
2. **Notification Function**: `notify_job_cancelled()` triggers when a job is marked as cancelled
3. **Database Trigger**: `job_cancelled_trigger` automatically calls the notification function
4. **Checkpoints Table**: LangGraph uses this for conversation state persistence

### Cancellation Workflow
```mermaid
flowchart TD
  A[User clicks Cancel button in client app]
  B[Client sends POST to /cancel endpoint with messageId]
  C[Cancel handler updates jobs table: status='cancelled', cancelled=true]
  D[PostgreSQL trigger fires notify_job_cancelled()]
  E[Trigger sends pg_notify to 'job_cancelled' channel]
  F[Job processor receives notification via LISTEN]
  G[Job processor calls AbortController.abort() on running job]
  H[LangGraph workflow stops processing]
  I[Client receives cancellation confirmation]
```

### Implementation Details

#### Client-Side Cancellation
- User clicks cancel button in `ChatInputComponent`
- `handleCancel()` in `AssistantModel` sends POST to `/cancel` endpoint
- Client stops showing loading indicator and waits for cancellation confirmation

#### Server-Side Processing
- **Cancel Handler** (`cancel.ts`): Updates database and returns success response
- **Database Trigger**: Automatically fires when `cancelled` field changes from false to true
- **PostgreSQL NOTIFY**: Sends real-time signal to any listening connections

#### Job Processor Cancellation
- **LISTEN/NOTIFY**: Job processor maintains persistent database connection listening to 'job_cancelled' channel
- **AbortController**: Each job gets an AbortController that can signal cancellation
- **Running Jobs Map**: Tracks currently executing jobs with their abort functions
- **Immediate Response**: Cancellation is processed in real-time without polling

#### LangGraph Integration
- **Signal Propagation**: AbortController signal is passed to LangGraph workflow
- **Graceful Shutdown**: Workflow stops processing and releases resources
- **State Cleanup**: Partial results are discarded, conversation state remains intact

### Error Handling
- **Database Failures**: Cancellation requests fail gracefully with 500 responses
- **Missing Jobs**: Returns 400 if messageId is not provided
- **Network Issues**: Client handles connection failures and retries as needed
- **Partial Cancellations**: If cancellation fails, job continues processing normally

## Troubleshooting

- Check CloudWatch logs for Lambda function errors
- Check SQS queue for stuck messages
