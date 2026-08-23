import { buildPresignParts } from "./agentcore-auth";

// The expected canonical request below is byte-for-byte what botocore's
// SigV4QueryAuth produced for these exact inputs (captured from a live run against
// the staging stack, where the resulting signature was accepted by the AgentCore
// data plane). If this test fails, the presigned URL will 403 with a signature
// mismatch — do not "fix" the expectation without re-verifying against botocore.
describe("buildPresignParts", () => {
  const parts = buildPresignParts({
    host: "bedrock-agentcore.us-east-1.amazonaws.com",
    runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore_staging-guJgof856F",
    accessKeyId: "AKIDEXAMPLE",
    sessionToken: "TOKENTOKEN",
    sessionId: "smoke-fixed-00000000000000000000",
    region: "us-east-1",
    amzDate: "20260807T133925Z",
    expires: 300,
  });

  it("matches botocore's canonical request byte-for-byte", () => {
    expect(parts.canonicalRequest).toBe(
      [
        "GET",
        "/runtimes/arn%253Aaws%253Abedrock-agentcore%253Aus-east-1%253A816253370536%253Aruntime%252Fdavai_agentcore_staging-guJgof856F/ws",
        "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDEXAMPLE%2F20260807%2Fus-east-1%2Fbedrock-agentcore%2Faws4_request&X-Amz-Date=20260807T133925Z&X-Amz-Expires=300&X-Amz-Security-Token=TOKENTOKEN&X-Amz-SignedHeaders=host&X-Amzn-Bedrock-AgentCore-Runtime-Session-Id=smoke-fixed-00000000000000000000",
        "host:bedrock-agentcore.us-east-1.amazonaws.com\n",
        "host",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ].join("\n")
    );
  });

  it("request path is single-encoded while the canonical path is double-encoded", () => {
    expect(parts.requestPath).toContain("%3A");
    expect(parts.requestPath).not.toContain("%253A");
    expect(parts.canonicalPath).toContain("%253A");
  });
});
