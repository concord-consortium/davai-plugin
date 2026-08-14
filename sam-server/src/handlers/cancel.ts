import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { authorizeRequest } from "../utils/auth-utils";
import { requestCancel } from "../agentcore/job-store";

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

    // Mark cancelled and abort the in-flight turn. Was: an UPDATE whose pg trigger
    // fired pg_notify('job_cancelled'), which the job-processor picked up via LISTEN.
    requestCancel(messageId);

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
