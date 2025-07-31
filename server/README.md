# DAVAI Server

This directory contains the Express-based server for the DAVAI plugin, deployed via AWS Lambda using `@vendia/serverless-express`.

It also contains the worker that will poll for scheduled jobs and process them as needed.

Workflow:

1) Client app sends a request to server app's /message endpoint (in index.ts)
2) Server app assigns the message an ID, saves message metadata to a job in the LLMJobs DynamoDB table. (Server app can also handle cancelling jobs at its /cancel endpoint)
4) SQS queues jobs for background processing by the worker
5) Worker polls SQS for unprocessed jobs, processes them using LangChain, and then updates the job's status in DynamoDB
6) Client app polls server app's /status endpoint for results of a job

## Development

First, run `npm install`.

Before running the server or worker, start up the required infrastructure by running `npm run dev:infra`.

If you have not already done so, create the `LLMJobs` table in DynamoDB:

```
aws dynamodb create-table \
  --table-name LLMJobs \
  --attribute-definitions AttributeName=messageId,AttributeType=S \
  --key-schema AttributeName=messageId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000
```

To run the worker locally, make sure you are in the `server` directory and run `npm run worker` 

To run the server locally, make sure you are in the `server` directory and run `npm start`.

## Deployment

Deployment involves manually uploading the zipped server files to AWS Lambda. This will likely change as we move forward with using LangChain.

## 🚀 Deployment Steps

### 1. Make sure you are in the server directory
### 2. Run `bash build-and-package.sh`
### 3. Upload the newly-created zip file to AWS Lambda
1. Go to the AWS Lambda Console
2. Select the Lambda function `davaiServer`
3. Under the "Code" section, choose "Upload from → .zip file"
4. Upload lambda.zip
5. Save and deploy

TODO: Add information about deploying worker.
TODO: Add information about related AWS DynamoDB and SQS setup?

