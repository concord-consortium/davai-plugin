# Local Development Guide

This guide explains how to set up and run the DAVAI server app locally for development work.

This is a work in progress. See "Performance Considerations" and "Next Steps" for some improvement ideas.

A key difference between a locally-running instance and a production instance of the server app is how jobs are processed. Locally, the server relies on direct database polling via `dev-job-poller-sam.ts`. In production, job processing uses SQS and Lambda triggers. Ideally, the local environment would support the same SQS and Lambda-based workflow as production.

## Prerequisites

1. **Docker** - For local PostgreSQL and ElasticMQ
2. **Node.js** - Version 18 or higher
3. **AWS SAM CLI** - For local Lambda function testing
4. **PostgreSQL client** - For database management (optional)

## Quick Start

### 1. Build the Application

```bash
# Build the SAM application (required first step and after changes to code in ./sam-server/src)
npm run sam:build
```

### 2. Configure Environment

```bash
# Copy and configure environment variables for SAM local Lambda functions
cp env-local.json.example env-local.json
# Edit env-local.json with your API keys, etc.

# Note: You will also need a .env file for local development scripts
# See "Dual Environment Configuration" section for more details
cp env.example .env
# Edit .env with your API keys, etc.
```

### 3. Start Local Infrastructure and Run Setup

```bash
# Start PostgreSQL and ElasticMQ containers
npm run dev:setup
```

### 4. Start Development Services

```bash
# Terminal 1: Start SAM local API Gateway
npm run dev:server

# Terminal 2: Start job poller
npm run dev:poller
```

### 5. Configure and Run Client App

In the client app's `.env` file (in the root directory), set:

```bash
LANGCHAIN_SERVER_URL=http://localhost:3000/
AUTH_TOKEN=local-dev-secret
```

Start/restart client app.

## Local Infrastructure

### What Gets Started

- **PostgreSQL 15** - Database for jobs and LangGraph checkpoints
- **ElasticMQ** - Local SQS emulator for job queuing
- **SAM Local** - Local Lambda function execution environment

### Current Limitations

> **TODO**: ElasticMQ is currently running but is not fully used in local development.
> - Message handlers still send to SQS (LLM_JOB_QUEUE_URL)
> - Dev poller bypasses SQS and polls database directly
> - Consider removing ElasticMQ from local dev. This may require modifying message handlers to skip SQS locally.

## Development Workflow

### Starting Development

```bash
# Build the application (required first step or whenever code changes are made)
npm run sam:build

# Complete setup (first time or after code changes)
npm run dev:setup

# Start your services
npm run dev:server    # Terminal 1
npm run dev:poller    # Terminal 2
```

### During Development

```bash
# Restart infrastructure (if needed)
npm run dev:infra:down
npm run dev:infra

# Rebuild after code changes
npm run sam:build

# Restart services
# (Stop [Ctrl+C] and restart dev:server and dev:poller)
```

**Note**: You must run `npm run sam:build` after making any changes to the code in ./sam-server/src before starting/re-starting `dev:server`.

### Stopping Development

```bash
# Stop services (Ctrl+C in respective terminals)
# Stop infrastructure
npm run dev:infra:down
```

## Available Scripts

| Script | Purpose |
|--------|---------|
| `dev:setup` | Complete local environment setup (starts infrastructure in addition to ensuring setup) |
| `dev:infra` | Start Docker infrastructure only (use when restarting after `dev:infra:down`) |
| `dev:infra:down` | Stop Docker infrastructure |
| `dev:server` | Start SAM local API Gateway |
| `dev:poller` | Start job processing poller |
| `sam:build` | Build SAM application |
| `sam:deploy` | Deploy to AWS |

## Architecture

### Local vs Production

| Component | Local | Production |
|-----------|-------|------------|
| **Database** | PostgreSQL Docker container | RDS PostgreSQL |
| **Job Queue** | Direct database polling | SQS + Lambda triggers |
| **API Gateway** | SAM local | AWS API Gateway |
| **Compute** | SAM local Lambda | AWS Lambda |
| **Secrets** | Environment variables | AWS Secrets Manager |

### How Local Development Works

1. **Client App** → Sends requests to `http://localhost:3000`
2. **SAM Local** → Routes requests to local Lambda functions
3. **Lambda Functions** → Process requests and store jobs in PostgreSQL
4. **Job Poller** → Continuously polls database for new jobs
5. **Job Processing** → Direct function calls (bypasses SQS locally)

## Environment Configuration

### Local Environment Variables

The `env-local.json` file configures environment variables for local Lambda functions. This file is gitignored and must be created manually.

#### Creating env-local.json

1. **Copy the example file:**
   ```bash
   cp env-local.json.example env-local.json
   ```

2. **Edit the file** and replace placeholder values:
   - `your-openai-api-key-here` → Your actual OpenAI API key
   - `your-google-api-key-here` → Your actual Google API key

#### File Structure

```json
{
  "MessageHandlerFunction": {
    "ENVIRONMENT": "local",
    "POSTGRES_CONNECTION_STRING": "postgresql://postgres:postgres@host.docker.internal:5432/postgres",
    "LLM_JOB_QUEUE_URL": "http://host.docker.internal:9324/queue/LLMJobQueue",
    "DAVAI_API_SECRET": "local-dev-secret",
    "OPENAI_API_KEY": "your-openai-api-key-here",
    "GOOGLE_API_KEY": "your-google-api-key-here"
  }
}
```

**Note**: The `env-local.json` file contains sensitive API keys and is gitignored for security. Never commit this file to version control.

### Dual Environment Configuration

The project uses two different environment file formats to support both local development and production deployment:

#### `.env` File (for local development scripts)
- **Format**: Key-value pairs (`KEY=value`)
- **Usage**: Local development scripts, job poller, database connections
- **Example**: `POSTGRES_CONNECTION_STRING=postgresql://postgres:postgres@localhost:5432/postgres`

#### `env-local.json` (for SAM local Lambda functions)
- **Format**: JSON with function-specific configurations
- **Usage**: SAM local Lambda function execution
- **Example**: `{"MessageHandlerFunction": {"POSTGRES_CONNECTION_STRING": "..."}}`

#### Why Both Are Needed

1. **Local Development Scripts** (like `dev-job-poller-sam.ts`) use `.env` format
2. **SAM Local Lambda Functions** require `env-local.json` format
3. **Production Deployment** uses AWS Secrets Manager and environment variables from `template.yaml`
4. **Different Connection Strings**: Local scripts use `localhost`, Lambda functions use `host.docker.internal`

This redundancy is currently necessary to support the hybrid local development environment where some components run directly on your machine and others run in Docker containers via SAM local.

### Required API Keys

- **OpenAI API Key** - For GPT models
- **Google API Key** - For Gemini models
- **LangSmith API Key** - For LLM run tracking (Optional. To keep costs down, it's probably best to omit this unless you want to test tracing.)

## Database Schema

### Jobs Table

```sql
CREATE TABLE jobs (
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
```

### Triggers

- **Job Cancellation Trigger** - Notifies running jobs of cancellation requests
- **Automatic timestamps** - Updates `updated_at` on modifications

## Troubleshooting

### Common Issues

#### "Cannot connect to PostgreSQL"
- Ensure Docker containers are running: `docker ps`
- Check if `dev:infra` was run successfully

#### "Authorization failed"
- Verify `AUTH_TOKEN=local-dev-secret` in client app
- Check that `dev:server` is running with `env-local.json`

#### "Job status stuck at 'processing'"
- Ensure `dev:poller` is running
- Check poller logs for errors
- Verify database connectivity

#### "Import errors in job poller"
- Run `npm run sam:build` after code changes
- Restart the poller after rebuilding

### Debug Commands

```bash
# Check container status
docker ps

# View container logs
docker logs postgres-local
docker logs elasticmq

# Check database connection
docker exec postgres-local pg_isready -U postgres

# Connect to database
docker exec -it postgres-local psql -U postgres -d postgres
```

### Logs

- **SAM Local** - Check terminal running `dev:server`
- **Job Poller** - Check terminal running `dev:poller`
- **Database** - Use `docker logs postgres-local`
- **ElasticMQ** - Use `docker logs elasticmq`

## Performance Considerations

### Current Setup

- **1-second polling** - Fast response times for development
- **Direct database queries** - No SQS overhead locally
- **In-memory processing** - Jobs processed in the same process

### Optimization Opportunities

- **Conditional polling** - Only poll when there are active jobs
- **Batch processing** - Process multiple jobs in one poll cycle
- **Health checks** - Monitor database and service status
- **ElasticMQ removal** - Eliminate unused SQS emulation

## Next Steps

### Immediate Improvements

1. **Remove ElasticMQ redundancy** - Modify handlers to skip SQS locally
2. **Add health monitoring** - Service status and performance metrics
3. **Optimize polling** - Conditional and batch job processing

### Future Enhancements

1. **Hot reloading** - Automatic restart on code changes
2. **Database migrations** - Versioned schema management
3. **Local testing** - Unit and integration test setup
4. **Performance profiling** - Identify bottlenecks and optimizations

## Contributing

When making changes to the local development setup:

1. **Test thoroughly** - Ensure both local and production workflows work
2. **Update documentation** - Keep this guide current
3. **Consider impact** - Changes should not break production deployment
4. **Follow patterns** - Maintain consistency with existing scripts and configuration
