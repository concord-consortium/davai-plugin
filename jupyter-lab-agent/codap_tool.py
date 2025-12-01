"""
Ably-backed Strands tool for talking to a CODAP browser plugin.

Requirements:
    pip install strands-agents ably

You must set:
    - ABLY_API_KEY  (env var)
    - CODAP_CHANNEL_NAME (optional; default: "codap-demo")
"""

import os
import json
import uuid
import asyncio
from typing import Any, Dict

from strands import tool
from ably import AblyRealtime

from dotenv import load_dotenv

load_dotenv()

# ----------------------------------------------------------------------
# Global config
# ----------------------------------------------------------------------

# Global channel name – you can change this at runtime if you like.
CODAP_CHANNEL_NAME: str = os.environ.get("CODAP_CHANNEL_NAME", "codap-demo")

# Ably API key (from your Ably dashboard)
ABLY_API_KEY: str = os.environ.get("ABLY_API_KEY", "")

# Global Ably client + channel (lazy-initialized)
_ably_client: AblyRealtime | None = None
_ably_channel = None


async def _get_ably_channel():
    """
    Lazily connect to Ably and get the shared channel for CODAP<->agent traffic.
    """
    global _ably_client, _ably_channel

    if not ABLY_API_KEY:
        raise RuntimeError("ABLY_API_KEY not set")

    if _ably_client is None:
        print("[codap_request_via_ably] Connecting to Ably...", flush=True)
        _ably_client = AblyRealtime(ABLY_API_KEY, client_id="strands-agent")
        await _ably_client.connection.once_async("connected")
        print("[codap_request_via_ably] Ably connection established.", flush=True)

    if _ably_channel is None:
        print(f"[codap_request_via_ably] Getting channel '{CODAP_CHANNEL_NAME}'", flush=True)
        _ably_channel = _ably_client.channels.get(CODAP_CHANNEL_NAME)

    return _ably_channel


# ----------------------------------------------------------------------
# Strands tool
# ----------------------------------------------------------------------

@tool
async def codap_request_via_ably(
    request: Dict[str, Any],
    timeout_seconds: int = 20,
) -> Dict[str, Any]:
    """
    Send a request to a CODAP browser plugin via an Ably channel and wait for
    a response.

    The request should be in the form:
        {
          action: string;
          resource: string;
          graphID?: string;
          values?: any;
        }

    Args:
        request:   JSON-serializable data describing the request details.
        timeout_seconds: How long to wait for a matching response before failing.

    Returns:
        The "result" field from the CODAP plugin response, wrapped in a dict:
        {
          "ok": true/false,
          "result": ...,
          "error": "..."  # present if ok == false or timeout
        }
    """
    channel = await _get_ably_channel()

    call_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()

    # Future that will be completed when we receive our response
    response_future: asyncio.Future = loop.create_future()

    # Build the request message
    request_data = {
        "type": "codap-request",
        "call_id": call_id,
        "request": request,
    }

    print(
        f"[codap_request_via_ably] → Sending request "
        f"call_id={call_id}",
        flush=True,
    )

    # Callback for messages on this channel
    def _on_message(message):
        # We only care about "codap-response" messages
        if message.name != "codap-response":
            return

        try:
            data = json.loads(message.data)
        except Exception:
            return

        if not isinstance(data, dict):
            return

        if data.get("type") != "codap-response":
            return

        if data.get("call_id") != call_id:
            # Not our response
            return

        print(
            f"[codap_request_via_ably] ← Received response for call_id={call_id}",
            flush=True,
        )

        # This is the response we’re waiting for
        if not response_future.done():
            response_future.set_result(data)

    # Subscribe for responses *before* publishing
    await channel.subscribe(_on_message)

    try:
        # Publish the request for the CODAP plugin to pick up
        await channel.publish("codap-request", json.dumps(request_data))

        print(
            f"[codap_request_via_ably] Waiting up to {timeout_seconds}s for CODAP response...",
            flush=True,
        )

        # Wait for response or timeout
        try:
            raw_response = await asyncio.wait_for(
                response_future, timeout=timeout_seconds
            )
        except asyncio.TimeoutError:
            print(
                f"[codap_request_via_ably] ❌ Timeout after {timeout_seconds}s "
                f"for call_id={call_id}",
                flush=True,
            )
            return {
                "ok": False,
                "result": None,
                "error": f"Timed out waiting for CODAP response after {timeout_seconds} seconds.",
            }

        # Normalize shape for the agent
        ok = bool(raw_response.get("ok", True))
        if ok:
            print(
                f"[codap_request_via_ably] ✅ CODAP request succeeded.",
                flush=True,
            )
        else:
            print(
                f"[codap_request_via_ably] ❌ CODAP request failed: "
                f"{raw_response.get('error')}",
                flush=True,
            )
        return {
            "ok": ok,
            "result": raw_response.get("result"),
            "error": raw_response.get("error"),
        }

    finally:
        # Clean up subscription so we don’t leak callbacks
        try:
            channel.unsubscribe(_on_message)
            print(
                f"[codap_request_via_ably] Unsubscribed from responses for call_id={call_id}",
                flush=True,
            )
        except Exception as e:
            print(
                f"[codap_request_via_ably] Error during unsubscribe for call_id={call_id}: {e!r}",
                flush=True,
            )
            pass

  # {
  #   name: "create_request",
  #   description: "Create a request to send to the CODAP Data Interactive API",
  #   schema: createRequestJsonSchema as any,
  # }

# const createRequestJsonSchema = {
#   type: "object",
#   properties: {
#     action: { type: "string" },
#     resource: { type: "string" },
#     values: { type: "object", additionalProperties: true },
#   },
#   required: ["action", "resource"],
#   additionalProperties: false,
# } as const;
