import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.POSTGRES_CONNECTION_STRING
});

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

    // Query the database for job status
    const { rows } = await pool.query(
      `SELECT status, output FROM jobs WHERE message_id = $1`,
      [messageId]
    );

    if (rows.length === 0) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Job not found" })
      };
    }

    const job = rows[0];
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
