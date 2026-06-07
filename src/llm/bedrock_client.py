import asyncio
import json
import os
import time
import structlog
from dotenv import load_dotenv

load_dotenv()
log = structlog.get_logger()

# Frankfurt (eu-central-1) lineup — all verified callable in this account via
# list_inference_profiles + a live converse smoke test. Newest available, 3 vendors.
# If you move regions, the eu. prefix must change to match (us./global.).
BEDROCK_MODELS = [
    "eu.anthropic.claude-sonnet-4-6",
    "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    "eu.amazon.nova-2-lite-v1:0",
    "eu.amazon.nova-pro-v1:0",
    # NOTE: eu.mistral.pixtral-large-2502 was dropped — its Frankfurt request quota
    # throttles ~60% of calls (verified), crippling audits. Nova Pro is reliable here.
    # MiniMax/GLM aren't enabled as serverless profiles in this account.
]


def _make_body(model: str, messages: list[dict]) -> dict:
    """Convert OpenAI-style messages to Bedrock converse format."""
    system_msgs = [m["content"] for m in messages if m["role"] == "system"]
    user_msgs = [m for m in messages if m["role"] != "system"]

    body: dict = {
        "messages": [{"role": m["role"], "content": [{"text": m["content"]}]} for m in user_msgs],
        "inferenceConfig": {"maxTokens": 768, "temperature": 0.7},
    }
    if system_msgs:
        body["system"] = [{"text": s} for s in system_msgs]
    return body


class BedrockClient:
    def __init__(self):
        import boto3
        # On EC2: attach an IAM role with BedrockFullAccess. Remove static keys from .env.
        # Boto3 auto-discovers credentials from the EC2 instance metadata — no keys needed.
        kwargs = {"region_name": os.environ.get("AWS_REGION", "us-east-1")}
        if os.environ.get("AWS_ACCESS_KEY_ID"):
            kwargs["aws_access_key_id"] = os.environ.get("AWS_ACCESS_KEY_ID")
            kwargs["aws_secret_access_key"] = os.environ.get("AWS_SECRET_ACCESS_KEY")
        self.client = boto3.client("bedrock-runtime", **kwargs)

    def _call_sync(self, model: str, messages: list[dict]) -> dict:
        body = _make_body(model, messages)
        t0 = time.monotonic()
        response = self.client.converse(modelId=model, **body)
        latency_ms = int((time.monotonic() - t0) * 1000)

        text = response["output"]["message"]["content"][0]["text"]
        usage = response.get("usage", {})
        return {
            "text": text,
            "latency_ms": latency_ms,
            "tokens_in": usage.get("inputTokens"),
            "tokens_out": usage.get("outputTokens"),
            "provider": "bedrock",
        }

    async def complete(self, model: str, messages: list[dict], max_retries: int = 3) -> dict:
        loop = asyncio.get_event_loop()
        for attempt in range(max_retries):
            try:
                result = await loop.run_in_executor(None, self._call_sync, model, messages)
                log.info(
                    "llm_call",
                    provider="bedrock",
                    model=model,
                    latency_ms=result["latency_ms"],
                    tokens_in=result["tokens_in"],
                    tokens_out=result["tokens_out"],
                )
                return result
            except Exception as e:
                if attempt == max_retries - 1:
                    raise
                wait = 2 ** attempt
                log.warning("bedrock_error", error=str(e), attempt=attempt, wait=wait)
                await asyncio.sleep(wait)

        raise RuntimeError(f"Bedrock call failed after {max_retries} attempts")
