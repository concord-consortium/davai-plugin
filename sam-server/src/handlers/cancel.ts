import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Pool } from "pg";
import { authorizeRequest } from "../utils/auth-utils";

const pool = new Pool({
  connectionString: process.env.POSTGRES_CONNECTION_STRING
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {

  const authResult = await authorizeRequest(event);
  if (authResult.errorResponse) {
    return authResult.errorResponse;
  }
  
  try {

    const body = JSON.parse(event.body || "{}");
    const { messageId } = body;
    
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

    await pool.query(
      `UPDATE jobs
       SET status = $1, cancelled = $2, updated_at = NOW()
       WHERE message_id = $3`,
      ["cancelled", true, messageId]
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ 
        status: "cancelled", 
        message: "Job marked as cancelled" 
      })
    };

  } catch (error: any) {
    console.error("Error cancelling job:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ 
        error: "Failed to cancel job", 
        details: error.message 
      })
    };
  }
};
