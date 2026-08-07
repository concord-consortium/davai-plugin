// Smoke test for the PUBLIC browser access path to the AgentCore staging stack:
//   Cognito unauthenticated identity -> temp AWS credentials -> SigV4 presigned
//   WebSocket URL -> AgentCore data plane -> container /ws.
// This is exactly the sequence the deployed DAVAI client performs (no AWS SDK,
// plain fetch + HMAC), so it doubles as a reference implementation for the
// client transport. Requires no AWS profile — the whole point is that it runs
// with only the public identity-pool id.
//
// Usage: node scripts/agentcore-cognito-smoke.mjs [message]
import { createHmac, createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";

const REGION = "us-east-1";
const IDENTITY_POOL_ID = "us-east-1:f9ef35df-041f-4731-813f-67e998dbc98f";
const RUNTIME_ARN = "arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore_staging-guJgof856F";
const MESSAGE = process.argv[2] || "Reply with exactly: pong";

// ---- 1. Cognito unauthenticated credentials (plain REST, no SDK) ------------
async function cognito(target, body) {
  const res = await fetch(`https://cognito-identity.${REGION}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityService.${target}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${target} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Classic (basic) flow: the enhanced flow's GetCredentialsForIdentity scopes
// credentials to a fixed AWS service allowlist that EXCLUDES bedrock-agentcore,
// so we exchange an OpenID token with STS directly (AllowClassicFlow on the pool).
const UNAUTH_ROLE_ARN = "arn:aws:iam::816253370536:role/davai-agentcore-staging-unauth";

const { IdentityId } = await cognito("GetId", { IdentityPoolId: IDENTITY_POOL_ID });
const { Token } = await cognito("GetOpenIdToken", { IdentityId });

const stsRes = await fetch(`https://sts.${REGION}.amazonaws.com/`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    Action: "AssumeRoleWithWebIdentity",
    Version: "2011-06-15",
    RoleArn: UNAUTH_ROLE_ARN,
    RoleSessionName: "davai-web",
    WebIdentityToken: Token,
    DurationSeconds: "3600",
  }),
});
const stsXml = await stsRes.text();
if (!stsRes.ok) throw new Error(`STS failed: ${stsRes.status} ${stsXml.slice(0, 300)}`);
const xmlVal = (tag) => stsXml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1];
const Credentials = {
  AccessKeyId: xmlVal("AccessKeyId"),
  SecretKey: xmlVal("SecretAccessKey"),
  SessionToken: xmlVal("SessionToken"),
};
console.log(`[cognito] identity ${IdentityId}, classic-flow key ${Credentials.AccessKeyId.slice(0, 8)}…, expires ${xmlVal("Expiration")}`);

// ---- 2. SigV4 presigned WebSocket URL --------------------------------------
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const sha256hex = (data) => createHash("sha256").update(data).digest("hex");
// RFC 3986 encoding (SigV4 requires !'()* encoded too)
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function presignWsUrl({ accessKeyId, secretKey, sessionToken, runtimeArn, sessionId, expires = 300 }) {
  const host = `bedrock-agentcore.${REGION}.amazonaws.com`;
  const service = "bedrock-agentcore";
  const path = `/runtimes/${enc(runtimeArn)}/ws`;
  // Canonical URI matches botocore SigV4QueryAuth: the request path's %XX
  // sequences are encoded AGAIN (double encoding), payload hash is sha256("").
  const canonicalPath = `/runtimes/${enc(enc(runtimeArn))}/ws`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${REGION}/${service}/aws4_request`;

  const query = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-Security-Token": sessionToken,
    "X-Amz-SignedHeaders": "host",
    "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
  };
  const canonicalQuery = Object.keys(query).sort()
    .map((k) => `${enc(k)}=${enc(query[k])}`)
    .join("&");
  // Payload hash: sha256 of the empty string (botocore SigV4QueryAuth; the
  // S3-style "UNSIGNED-PAYLOAD" sentinel is rejected here).
  const canonicalRequest = ["GET", canonicalPath, canonicalQuery, `host:${host}\n`, "host", sha256hex("")].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), REGION), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `wss://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

const sessionId = `smoke-${randomUUID()}`; // >=33 chars
const wsUrl = presignWsUrl({
  accessKeyId: Credentials.AccessKeyId,
  secretKey: Credentials.SecretKey,
  sessionToken: Credentials.SessionToken,
  runtimeArn: RUNTIME_ARN,
  sessionId,
});
console.log(`[presign] url ready (session ${sessionId})`);

// ---- 3. Connect and run one turn -------------------------------------------
const ws = new WebSocket(wsUrl);
const t0 = Date.now();
ws.on("open", () => {
  console.log(`[ws] connected in ${Date.now() - t0}ms`);
  ws.send(JSON.stringify({
    llmId: JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI" }),
    threadId: sessionId,
    message: MESSAGE,
  }));
});
ws.on("message", (d) => {
  const f = JSON.parse(d.toString());
  console.log(`[ws] ${Date.now() - t0}ms [${f.type}] ${(f.text || JSON.stringify(f.output) || f.error || "").slice(0, 100)}`);
  if (f.type === "result" || f.type === "error") { ws.close(); process.exit(f.type === "error" ? 1 : 0); }
});
ws.on("unexpected-response", (_req, res) => {
  console.error(`[ws] handshake failed: HTTP ${res.statusCode} ${res.headers["x-amzn-errortype"] || ""}`);
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => { console.error(body.slice(0, 300)); process.exit(1); });
});
ws.on("error", (e) => { console.error(`[ws] error: ${e.message}`); process.exit(1); });
setTimeout(() => { console.error("[ws] timeout"); process.exit(1); }, 60000);
