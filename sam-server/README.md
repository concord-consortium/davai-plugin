# Davai Plugin Server - SAM Version

This is the AWS SAM version of the DAVAI server app, converted from the Express-based server.

## Prerequisites

1. Install AWS SAM CLI: `brew install aws-sam-cli` (macOS)
2. Install Node.js dependencies: `npm install` (from inside ./sam-server)
3. Ensure you have AWS credentials configured (`aws configure`)

## Quick Start

### Build and Deploy to AWS

```bash
# Build the SAM application
npm run sam:build

# Deploy to AWS
npm run sam:deploy
```

### For an unguided/faster deploy to production
First set the production instance database password by running `export DB_PASSWORD='database password'` in your terminal

Then:

```bash
# Deploy to production
npm run sam:deploy:production:fast
```

### Build and Deploy to Staging

There are currently two staging instances set up in AWS: staging-a and staging-b. Each has their own set of Lambda functions, secrets, API gateway, and database. The two separate staging databases are on the same RDS instance, however. The two staging instances also share the same VPC and related infrastructure (subnets, security groups, route tables, etc.).

Building for staging can be done using the same script as for production.

```bash
# Build the SAM application
npm run sam:build
```

There are four new scripts for deploying to staging. For a guided deployment, use one of these:

```bash
# Deploy to Staging A
npm run sam:deploy:staging-a

# Deploy to Staging B
npm run sam:deploy:staging-b
```

For an unguided, faster deployment, use one of the below.

NOTE: You will first need to set the staging instance database password by running `export DB_PASSWORD='database password'` in your terminal in order for the fast deploy to work.

```bash
# Deploy to Staging A
npm run sam:deploy:staging-a:fast

# Deploy to Staging B
npm run sam:deploy:staging-b:fast
```

### Local Development

For local development setup and workflow, see [DEV-README.md](./DEV-README.md).

## AWS Infrastructure

The deployed application requires the following AWS resources:

### Core Infrastructure
- **VPC** - Custom VPC with public/private subnets
- **NAT Gateway** - For private subnet internet access
- **Internet Gateway** - For public subnet internet access

### Compute & API
- **API Gateway** - REST API endpoints for client communication
- **Lambda Functions** - Serverless compute for request processing
- **Lambda Security Groups** - Network access control

### Data & Messaging
- **RDS PostgreSQL** - Database for jobs and LangGraph checkpoints
- **SQS Queue** - Job queuing and processing
- **Secrets Manager** - Secure storage for API keys and secrets

### Lambda Functions
- **MessageHandlerFunction** - Processes incoming chat messages
- **ToolHandlerFunction** - Handles tool execution requests
- **JobProcessorFunction** - Processes queued jobs from SQS
- **StatusHandlerFunction** - Provides job status updates
- **SetupFunction** - Initializes database schema and triggers (invoked directly via AWS CLI)

## API Endpoints

- **`POST /default/davaiServer/message`** - Create message jobs
- **`POST /default/davaiServer/tool`** - Create tool jobs
- **`GET /default/davaiServer/status?messageId=X`** - Check job status
- **`POST /default/davaiServer/cancel`** - Cancel jobs

## Architecture

- **API Gateway**: Handles HTTP requests and routes to Lambda functions
- **Lambda Functions**: Process API requests and jobs asynchronously
- **RDS PostgreSQL**: Stores jobs, LangGraph checkpoints, and conversation state
- **SQS**: Queues jobs for background processing by the job processor
- **Secrets Manager**: Securely stores LLM API keys and other sensitive data

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

## LLM Instructions

The instructions text for the LLM prompt are in ./sam-server/src/text/instructions.ts. These are added to the `promptTemplate` defined in ./sam-server/src/utils/llm-utils.ts along with the CODAP API documentation defined in ./sam-server/src/text/codap-api-documentation.ts.

## LLM Providers

The code currently supports two LLM providers: Google and OpenAI. To add another provider, update the `createModelInstance` function in ./sam-server/utils/llm-utils.ts. Follow the pattern used for Google and OpenAI. You will also need to add a new environment variable for the associated API key. And finally, you will need to update the `llmList` in the client app's app-config.json file.

## Tool Functions

Tool functions are defined in ./sam-server/src/utils/tool-utils.ts. There are currently two tool functions:

- createRequestTool - Used for making CODAP API requests
- sonifyGraphTool - Used for selecting a graph for sonification

To add a new tool function, define it in tool-utils.ts and add then it to the `tools` array in the same file. You will also need to update the `processToolCall` action in the client app's `AssistantModel` to handle the tool call.

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
