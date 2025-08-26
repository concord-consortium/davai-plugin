import { getApiKey, getOpenAIKey, getGoogleKey } from "./env-utils";

jest.mock("@aws-sdk/client-secrets-manager", () => {
  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(async (cmd: any) => {
        // Simulate different secret values based on SecretId
        const secretId = cmd.input?.SecretId;
        if (secretId === "arn:aws:secretsmanager:us-east-1:123456789012:secret:openai-key") {
          return { SecretString: JSON.stringify({ apiKey: "openai-secret-key" }) };
        }
        if (secretId === "arn:aws:secretsmanager:us-east-1:123456789012:secret:google-key") {
          return { SecretString: JSON.stringify({ GOOGLE_API_KEY: "google-secret-key" }) };
        }
        if (secretId === "arn:aws:secretsmanager:us-east-1:123456789012:secret:plaintext-key") {
          return { SecretString: "plain-secret-value" };
        }
        return { SecretString: "fallback" };
      })
    })),
    GetSecretValueCommand: jest.fn().mockImplementation((input) => ({ input }))
  };
});

describe("env-utils", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("returns direct API key from env for getApiKey", async () => {
    // eslint-disable-next-line dot-notation
    process.env["OPENAI_API_KEY"] = "direct-key";
    const key = await getApiKey("OPENAI");
    expect(key).toBe("direct-key");
  });

  it("fetches and parses secret from AWS Secrets Manager (apiKey field)", async () => {
    // eslint-disable-next-line dot-notation
    process.env["OPENAI_API_KEY"] = "arn:aws:secretsmanager:us-east-1:123456789012:secret:openai-key";
    const key = await getApiKey("OPENAI");
    expect(key).toBe("openai-secret-key");
  });

  it("fetches and parses secret from AWS Secrets Manager (GOOGLE_API_KEY field)", async () => {
    // eslint-disable-next-line dot-notation
    process.env["GOOGLE_API_KEY"] = "arn:aws:secretsmanager:us-east-1:123456789012:secret:google-key";
    const key = await getApiKey("GOOGLE");
    expect(key).toBe("google-secret-key");
  });

  it("fetches and returns plaintext secret from AWS Secrets Manager", async () => {
    // eslint-disable-next-line dot-notation
    process.env["OPENAI_API_KEY"] = "arn:aws:secretsmanager:us-east-1:123456789012:secret:plaintext-key";
    const key = await getApiKey("OPENAI");
    expect(key).toBe("plain-secret-value");
  });

  it("throws if env var is missing", async () => {
    // eslint-disable-next-line dot-notation
    delete process.env["OPENAI_API_KEY"];
    await expect(getApiKey("OPENAI")).rejects.toThrow("Missing OPENAI_API_KEY environment variable");
  });

  it("getOpenAIKey and getGoogleKey call getApiKey with correct provider", async () => {
    // eslint-disable-next-line dot-notation
    process.env["OPENAI_API_KEY"] = "direct-key";
    // eslint-disable-next-line dot-notation
    process.env["GOOGLE_API_KEY"] = "direct-google-key";
    await expect(getOpenAIKey()).resolves.toBe("direct-key");
    await expect(getGoogleKey()).resolves.toBe("direct-google-key");
  });
});
