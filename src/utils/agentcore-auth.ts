// Browser-side auth for the deployed AgentCore runtime: Cognito unauthenticated
// identity -> temp AWS credentials (classic flow) -> SigV4 presigned WebSocket URL.
// Framework-free (plain fetch + WebCrypto); the Node reference implementation with the
// same construction, verified against botocore byte-for-byte, is
// scripts/agentcore-cognito-smoke.mjs.

import { AgentCoreConfig } from "./agentcore-config";

export interface AwsTempCredentials {
  accessKeyId: string;
  secretKey: string;
  sessionToken: string;
  expiresAt: number; // epoch ms
}

// ---------------------------------------------------------------- credentials

async function cognitoCall(region: string, target: string, body: unknown): Promise<any> {
  const res = await fetch(`https://cognito-identity.${region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityService.${target}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Cognito ${target} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Classic (basic) flow: GetId -> GetOpenIdToken -> sts:AssumeRoleWithWebIdentity.
// The enhanced flow's GetCredentialsForIdentity scopes credentials to a fixed AWS
// service allowlist that excludes bedrock-agentcore, so it cannot be used here.
async function fetchCredentials(config: AgentCoreConfig): Promise<AwsTempCredentials> {
  const { IdentityId } = await cognitoCall(config.region, "GetId", {
    IdentityPoolId: config.identityPoolId,
  });
  const { Token } = await cognitoCall(config.region, "GetOpenIdToken", { IdentityId });

  const res = await fetch(`https://sts.${config.region}.amazonaws.com/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      Action: "AssumeRoleWithWebIdentity",
      Version: "2011-06-15",
      RoleArn: config.unauthRoleArn,
      RoleSessionName: "davai-plugin",
      WebIdentityToken: Token,
      DurationSeconds: "3600",
    }),
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`STS AssumeRoleWithWebIdentity failed: ${res.status} ${xml.slice(0, 200)}`);
  const val = (tag: string) => xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1];
  const accessKeyId = val("AccessKeyId");
  const secretKey = val("SecretAccessKey");
  const sessionToken = val("SessionToken");
  const expiration = val("Expiration");
  if (!accessKeyId || !secretKey || !sessionToken) {
    throw new Error("STS response missing credentials");
  }
  return { accessKeyId, secretKey, sessionToken, expiresAt: expiration ? Date.parse(expiration) : Date.now() + 3600_000 };
}

// Cache per identity pool; refresh when within 5 minutes of expiry.
const credentialCache = new Map<string, Promise<AwsTempCredentials>>();

export async function getAgentCoreCredentials(config: AgentCoreConfig): Promise<AwsTempCredentials> {
  const key = config.identityPoolId;
  const cached = credentialCache.get(key);
  if (cached) {
    const creds = await cached.catch(() => null);
    if (creds && creds.expiresAt - Date.now() > 5 * 60_000) return creds;
  }
  const fresh = fetchCredentials(config);
  credentialCache.set(key, fresh);
  return fresh;
}

// -------------------------------------------------------------------- SigV4

// RFC 3986 encoding (SigV4 also requires !'()* percent-encoded).
const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

const sha256hex = async (data: string) =>
  toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)));

export interface PresignParts {
  requestPath: string;
  canonicalPath: string;
  canonicalQuery: string;
  canonicalRequest: string;
  scope: string;
  amzDate: string;
}

// Exposed for tests: build the canonical pieces exactly as botocore's SigV4QueryAuth
// does — request path single-encodes the ARN; the CANONICAL path encodes those bytes
// again (double encoding); the payload hash is sha256 of the empty string.
export function buildPresignParts(opts: {
  host: string;
  runtimeArn: string;
  accessKeyId: string;
  sessionToken: string;
  sessionId: string;
  region: string;
  amzDate: string;
  expires: number;
}): PresignParts {
  const service = "bedrock-agentcore";
  const dateStamp = opts.amzDate.slice(0, 8);
  const scope = `${dateStamp}/${opts.region}/${service}/aws4_request`;
  const requestPath = `/runtimes/${enc(opts.runtimeArn)}/ws`;
  const canonicalPath = `/runtimes/${enc(enc(opts.runtimeArn))}/ws`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${opts.accessKeyId}/${scope}`,
    "X-Amz-Date": opts.amzDate,
    "X-Amz-Expires": String(opts.expires),
    "X-Amz-Security-Token": opts.sessionToken,
    "X-Amz-SignedHeaders": "host",
    "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": opts.sessionId,
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
  const canonicalRequest =
    ["GET", canonicalPath, canonicalQuery, `host:${opts.host}\n`, "host", EMPTY_SHA256].join("\n");
  return { requestPath, canonicalPath, canonicalQuery, canonicalRequest, scope, amzDate: opts.amzDate };
}

export async function presignAgentCoreWsUrl(
  config: AgentCoreConfig,
  creds: AwsTempCredentials,
  sessionId: string,
  expires = 300
): Promise<string> {
  const host = `bedrock-agentcore.${config.region}.amazonaws.com`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const parts = buildPresignParts({
    host,
    runtimeArn: config.runtimeArn,
    accessKeyId: creds.accessKeyId,
    sessionToken: creds.sessionToken,
    sessionId,
    region: config.region,
    amzDate,
    expires,
  });
  const dateStamp = amzDate.slice(0, 8);
  const stringToSign =
    ["AWS4-HMAC-SHA256", amzDate, parts.scope, await sha256hex(parts.canonicalRequest)].join("\n");
  const kDate = await hmac(new TextEncoder().encode(`AWS4${creds.secretKey}`), dateStamp);
  const kRegion = await hmac(kDate, config.region);
  const kService = await hmac(kRegion, "bedrock-agentcore");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));
  return `wss://${host}${parts.requestPath}?${parts.canonicalQuery}&X-Amz-Signature=${signature}`;
}

// Convenience used by the transport: credentials (cached) + presigned URL for a session.
export async function getAgentCoreConnectUrl(config: AgentCoreConfig, sessionId: string): Promise<string> {
  const creds = await getAgentCoreCredentials(config);
  return presignAgentCoreWsUrl(config, creds, sessionId);
}
