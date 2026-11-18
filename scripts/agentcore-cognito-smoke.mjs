// Smoke test for the PUBLIC browser access path to an AgentCore stack:
//   Cognito unauthenticated identity -> temp AWS credentials -> SigV4 presigned
//   WebSocket URL -> AgentCore data plane -> container /ws.
// This is exactly the sequence the deployed DAVAI client performs (no AWS SDK,
// plain fetch + HMAC), so it doubles as a reference implementation for the
// client transport. With no --stack it needs no AWS profile — the whole point is
// that it runs with only the public identity-pool id.
//
// Usage: node scripts/agentcore-cognito-smoke.mjs [options] [message]
//   (no options)          the staging stack, using the public values below
//   --stack <name>        read the identity pool, role and runtime from that stack's
//                         outputs (needs AWS credentials for its account)
//   --profile <profile>   AWS profile for --stack (default: the default profile)
//   --qualifier <name>    invoke a named endpoint, e.g. "production" (default: DEFAULT)
import { createHmac, createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";

const REGION = "us-east-1";

const opts = {};
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) opts[a.slice(2)] = process.argv[++i];
  else positional.push(a);
}
const MESSAGE = positional[0] || "Reply with exactly: pong";
const QUALIFIER = opts.qualifier;

// The staging stack's public values (infra/DEPLOYED.md).
let IDENTITY_POOL_ID = "us-east-1:f9ef35df-041f-4731-813f-67e998dbc98f";
let UNAUTH_ROLE_ARN = "arn:aws:iam::816253370536:role/davai-agentcore-staging-unauth";
let RUNTIME_ARN = "arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore_staging-guJgof856F";

if (opts.stack) {
  const args = ["cloudformation", "describe-stacks", "--region", REGION, "--stack-name", opts.stack,
    "--query", "Stacks[0].Outputs", "--output", "json"];
  if (opts.profile) args.push("--profile", opts.profile);
  const { stdout } = await promisify(execFile)("aws", args);
  const outputs = Object.fromEntries(JSON.parse(stdout).map((o) => [o.OutputKey, o.OutputValue]));
  IDENTITY_POOL_ID = outputs.IdentityPoolId;
  UNAUTH_ROLE_ARN = outputs.UnauthenticatedRoleArn;
  RUNTIME_ARN = outputs.AgentRuntimeArn;
}
console.log(`[target] ${RUNTIME_ARN} (endpoint ${QUALIFIER || "DEFAULT"})`);

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
console.log(`[cognito] identity ${IdentityId}, classic-flow credentials expire ${xmlVal("Expiration")}`);

// ---- 2. SigV4 presigned WebSocket URL --------------------------------------
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const sha256hex = (data) => createHash("sha256").update(data).digest("hex");
// RFC 3986 encoding (SigV4 requires !'()* encoded too)
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function presignWsUrl({ accessKeyId, secretKey, sessionToken, runtimeArn, sessionId, qualifier, expires = 300 }) {
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
  // The endpoint to invoke. It is signed like the other query parameters.
  if (qualifier) query.qualifier = qualifier;
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
  qualifier: QUALIFIER,
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
// The backend splits frames over 8,000 characters into { type: "chunk", data, last? }
// envelopes (backend/src/ws.ts); a long reply's result frame arrives that way.
let chunkBuffer = "";
ws.on("message", (d) => {
  let f = JSON.parse(d.toString());
  if (f.type === "chunk") {
    chunkBuffer += f.data;
    if (!f.last) return;
    f = JSON.parse(chunkBuffer);
    chunkBuffer = "";
  }
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
