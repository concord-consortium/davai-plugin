import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { nanoid } from "nanoid";
import { MessageJobInput } from "../types";
import { authorizeRequest } from "../utils/auth-utils";
import { enqueueJob, insertJob } from "../agentcore/job-store";

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {

  const authResult = await authorizeRequest(event);
  if (authResult.errorResponse) {
    return authResult.errorResponse;
  }
  
  try {

    const body = JSON.parse(event.body || "{}");
    const { llmId, message, threadId, dataContexts, graphs, effort } = body;

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
    const jobInput: MessageJobInput = { llmId, threadId, message, dataContexts, graphs, effort };
    
    // Store the job in this microVM's memory (was: INSERT into the jobs table)
    insertJob(messageId, "message", jobInput);

    // Start the turn in the background (was: send to SQS)
    enqueueJob(messageId);

    return {
      statusCode: 202,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ messageId, status: "queued" })
    };
  } catch (error: any) {
    console.error("Error processing message:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ 
        error: "Failed to queue message", 
        details: error.message 
      })
    };
  }
};
