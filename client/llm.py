from __future__ import annotations

import asyncio
import json

from fastmcp import Client
from openai import OpenAI

from config import AppConfig


def create_openai_client(config: AppConfig) -> OpenAI:
    return OpenAI(api_key=config.openai_api_key, base_url=config.openai_base_url)


def to_openai_tools(mcp_tools: list) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description or f"MCP 工具 {t.name}",
                "parameters": t.inputSchema or {"type": "object", "properties": {}},
            },
        }
        for t in mcp_tools
    ]


def result_value(result) -> str:
    return str(getattr(result, "data", ""))


async def ask_with_llm(
    mcp_client: Client,
    llm_client: OpenAI,
    config: AppConfig,
    user_prompt: str,
) -> str:
    tools = to_openai_tools(await mcp_client.list_tools())
    messages = [
        {"role": "system", "content": "你是教学演示助手。遇到数学算术问题时优先调用工具（加减乘除），再给出简洁中文答案。"},
        {"role": "user", "content": user_prompt},
    ]

    for _ in range(config.llm_max_tool_rounds):
        completion = await asyncio.to_thread(
            llm_client.chat.completions.create,
            model=config.openai_model,
            messages=messages,
            tools=tools,
            tool_choice="auto",
            temperature=0,
        )
        message = completion.choices[0].message
        tool_calls = message.tool_calls or []
        if not tool_calls:
            return (message.content or "").strip()

        messages.append(
            {
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {"name": c.function.name, "arguments": c.function.arguments},
                    }
                    for c in tool_calls
                ],
            }
        )

        for call in tool_calls:
            result = await mcp_client.call_tool(call.function.name, json.loads(call.function.arguments or "{}"))
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "name": call.function.name,
                    "content": json.dumps({"result": result_value(result)}, ensure_ascii=False),
                }
            )

    return ""
