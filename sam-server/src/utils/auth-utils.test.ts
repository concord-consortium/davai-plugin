import { authorizeRequest } from "./auth-utils";
import { APIGatewayProxyEvent } from "aws-lambda";

jest.mock("@aws-sdk/client-secrets-manager", () => {
  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(async (cmd: any) => {
        const secretId = cmd.input?.SecretId;
        if (secretId === "test-arn") {
          return { SecretString: JSON.stringify({ secret: "super-secret" }) };
        }
        throw new Error("Secret not found");
      })
    })),
    GetSecretValueCommand: jest.fn().mockImplementation((input) => ({ input }))
  };
});

const baseEvent: APIGatewayProxyEvent = {
  body: null,
  headers: {},
  multiValueHeaders: {},
  httpMethod: "GET",
  isBase64Encoded: false,
  path: "/",
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  requestContext: {} as any,
  resource: "/",
  stageVariables: null
};

describe("authorizeRequest", () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.DAVAI_API_SECRET = "test-arn";
    process.env.AWS_REGION = "us-east-1";
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("authorizes when header matches secret", async () => {
    const event = { ...baseEvent, headers: { authorization: "super-secret" } };
    const result = await authorizeRequest(event);
    expect(result.authorized).toBe(true);
    expect(result.errorResponse).toBeUndefined();
  });

  it("authorizes when Authorization header matches secret", async () => {
    const event = { ...baseEvent, headers: { Authorization: "super-secret" } };
    const result = await authorizeRequest(event);
    expect(result.authorized).toBe(true);
    expect(result.errorResponse).toBeUndefined();
  });

  it("rejects when header does not match secret", async () => {
    const event = { ...baseEvent, headers: { authorization: "wrong" } };
    const result = await authorizeRequest(event);
    expect(result.authorized).toBe(false);
    expect(result.errorResponse?.statusCode).toBe(401);
    expect(result.errorResponse?.body).toContain("Unauthorized");
  });

});
