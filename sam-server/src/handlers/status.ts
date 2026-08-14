import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getJob } from "../agentcore/job-store";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Get messageId from query parameters
    const messageId = event.queryStringParameters?.messageId;
    if (!messageId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Missing messageId" })
      };
    }

    // Look up the job in this microVM's memory (was: SELECT from the jobs table)
    const job = getJob(messageId);

    if (!job) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Job not found" })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        messageId,
        status: job.status,
        output: job.output || null
      })
    };

  } catch (error: any) {
    console.error("Error fetching job status:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ 
        error: "Failed to fetch job status", 
        details: error.message 
      })
    };
  }
};
