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

## Troubleshooting

- Check CloudWatch logs for Lambda function errors
- Check SQS queue for stuck messages
