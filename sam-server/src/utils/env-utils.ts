import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const cache = new Map<string, string>();

const isSecretsArn = (v?: string): v is string => {
  return !!v && v.startsWith("arn:aws:secretsmanager:");
};

const regionFromArn = (arn?: string): string => {
  const m = arn?.match(/^arn:aws:secretsmanager:([a-z0-9-]+):/);
  return m?.[1] ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
};

const fetchSecretValue = async (secretIdOrArn: string, regionHint?: string): Promise<string> => {
  const cacheKey = `secret:${secretIdOrArn}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) as string;

  const sm = new SecretsManagerClient({
    region: regionHint ?? regionFromArn(secretIdOrArn),
  });
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretIdOrArn }));

  const raw =
    res.SecretString ??
    (res.SecretBinary ? Buffer.from(res.SecretBinary).toString("utf8") : "");

  // Support either plaintext or JSON with common keys
  let value: string;
  try {
    const obj = JSON.parse(raw);
    value =
      obj.apiKey ??
      obj.API_KEY ??
      obj.OPENAI_API_KEY ??
      obj.openaiApiKey ??
      obj.GOOGLE_API_KEY ??
      obj.googleApiKey ??
      obj.key ??
      raw;
  } catch {
    value = raw;
  }

  cache.set(cacheKey, value);
  return value;
};

/**
 * Get an API key from env or AWS Secrets Manager.
 * 
 * Precedence per provider (e.g., "OPENAI", "GOOGLE"):
 * 1) {PROVIDER}_API_KEY = direct key for local dev
 * 2) {PROVIDER}_API_KEY = ARN of the secret to resolve
 */
export const getApiKey = async (provider: string, opts?: { region?: string }): Promise<string> => {
  const P = provider.toUpperCase();

  const direct = process.env[`${P}_API_KEY`];
  if (direct && !isSecretsArn(direct)) return direct;

  const secretIdOrArn = process.env[`${P}_API_KEY`];
  if (!secretIdOrArn) {
    throw new Error(`Missing ${P}_API_KEY environment variable`);
  }
  return fetchSecretValue(secretIdOrArn, opts?.region);
};

// Convenience wrappers, if you like:
export const getOpenAIKey = () => getApiKey("OPENAI");
export const getGoogleKey = () => getApiKey("GOOGLE");
