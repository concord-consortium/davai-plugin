import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export const authorizeRequest = async (event: APIGatewayProxyEvent): Promise<{ authorized: boolean; errorResponse?: APIGatewayProxyResult }> => {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
  const secretArn = process.env.DAVAI_API_SECRET;
  
  try {
    const command = new GetSecretValueCommand({ SecretId: secretArn });
    const response = await secretsClient.send(command);
    const secretValue = JSON.parse(response.SecretString || "{}").secret;
    
    if (authHeader !== secretValue) {
      return {
        authorized: false,
        errorResponse: {
          statusCode: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          },
          body: JSON.stringify({ error: "Unauthorized" })
        }
      };
    }
    
    return { authorized: true };
  } catch (error: any) {
    console.error("Authorization error:", error);
    return {
      authorized: false,
      errorResponse: {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Authorization failed", details: error.message })
      }
    };
  }
};
