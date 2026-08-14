// AgentCore bring-your-own-container entrypoint for the existing sam-server code.
//
// AgentCore's service contract is exactly two routes on port 8080:
//   GET  /ping         -> health check
//   POST /invocations  -> one invocation
//
// The existing Lambda handlers stay untouched behind it: this file synthesizes the
// APIGatewayProxyEvent each one already expects and returns its APIGatewayProxyResult
// verbatim, so the client sees byte-identical status codes and bodies. The four old
// API Gateway routes are selected by an `action` field on the invocation payload:
//
//   {"action":"message", llmId, message, threadId, dataContexts?, graphs?, effort?}
//   {"action":"tool",    llmId, message, threadId, effort?}
//   {"action":"status",  messageId}
//   {"action":"cancel",  messageId}
//
// Mapping the client's four HTTP paths onto that one endpoint is the bridge's job
// (it has to sign requests with SigV4 anyway), which is why the client is unchanged.

import * as dotenv from "dotenv";
dotenv.config();

import http from "node:http";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handler as messageHandler } from "../handlers/message";
import { handler as toolHandler } from "../handlers/tool";
import { handler as statusHandler } from "../handlers/status";
import { handler as cancelHandler } from "../handlers/cancel";
import { processJob } from "../handlers/job-processor";
import { setJobRunner } from "./job-store";

// Close the loop the SQS queue used to close: submit handlers enqueue, this runs it.
setJobRunner(processJob);

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
// AgentCore's own payload cap is 100 MB; DAVAI turn inputs are far smaller.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

type Action = "message" | "tool" | "status" | "cancel";

const handlers: Record<Action, (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>> = {
  message: messageHandler,
  tool: toolHandler,
  status: statusHandler,
  cancel: cancelHandler,
};

const readJsonBody = (req: http.IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });

// Build the event shape the Lambda handlers read: they touch only `headers`,
// `body`, and `queryStringParameters`, so the rest is filled in as empty.
const toProxyEvent = (
  req: http.IncomingMessage,
  action: Action,
  payload: Record<string, any>
): APIGatewayProxyEvent => {
  const { action: _omit, ...rest } = payload;
  return {
    headers: req.headers as APIGatewayProxyEvent["headers"],
    body: JSON.stringify(rest),
    // status reads messageId from the query string; the others read the body.
    queryStringParameters: action === "status" ? { messageId: rest.messageId } : null,
    httpMethod: req.method || "POST",
    path: `/${action}`,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    resource: `/${action}`,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
  };
};

const sendJson = (res: http.ServerResponse, statusCode: number, body: string) => {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
  });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/ping" || req.url?.startsWith("/ping?"))) {
      return sendJson(res, 200, JSON.stringify({ status: "Healthy" }));
    }

    if (req.method !== "POST" || req.url !== "/invocations") {
      return sendJson(res, 404, JSON.stringify({ error: "not found" }));
    }

    let payload: any;
    try {
      payload = await readJsonBody(req);
    } catch (error: any) {
      return sendJson(res, 400, JSON.stringify({ error: error.message }));
    }

    const action = payload?.action as Action;
    const handler = handlers[action];
    if (!handler) {
      return sendJson(
        res,
        400,
        JSON.stringify({ error: `Unknown action: ${action}. Expected one of ${Object.keys(handlers).join(", ")}` })
      );
    }

    const result = await handler(toProxyEvent(req, action, payload));
    return sendJson(res, result.statusCode, result.body);
  } catch (error: any) {
    console.error("Invocation failed:", error);
    return sendJson(res, 500, JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`davai sam-server listening on http://${HOST}:${PORT}  (GET /ping, POST /invocations)`);
});
