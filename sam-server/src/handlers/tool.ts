import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Pool } from "pg";
import { nanoid } from "nanoid";
import { ToolJobInput } from "../types";
import { authorizeRequest } from "../utils/auth-utils";

const pool = new Pool({
  connectionString: process.env.POSTGRES_CONNECTION_STRING
});

const sqs = new SQSClient({});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {

  const authResult = await authorizeRequest(event);
  if (authResult.errorResponse) {
    return authResult.errorResponse;
  }
  
  try {
    const body = JSON.parse(event.body || "{}");
    const { llmId, message, threadId } = body;

    if (!llmId || !message || !threadId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Missing required fields: llmId, message, threadId" })
      };
    }

    const messageId = nanoid();
    const jobInput: ToolJobInput = { llmId, threadId, message };
    
    // Store job in PostgreSQL
    await pool.query(
      `INSERT INTO jobs (message_id, kind, status, input, created_at, updated_at, cancelled)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)`,
      [messageId, "tool", "queued", jobInput, false]
    );

    // Send to SQS
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.LLM_JOB_QUEUE_URL,
      MessageBody: JSON.stringify({ messageId })
    }));

    return {
      statusCode: 202,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ messageId, status: "queued" })
    };
  } catch (error: any) {
    console.error("Error processing tool request:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ 
        error: "Failed to queue tool response", 
        details: error.message 
      })
    };
  }
};
