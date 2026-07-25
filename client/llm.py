from __future__ import annotations

import asyncio
import json

from fastmcp import Client
from openai import OpenAI

from config import AppConfig


def create_openai_client(config: AppConfig) -> OpenAI:
    """按配置里的 key/base_url 创建 OpenAI 兼容客户端（这里指阿里云百炼的 OpenAI 兼容接口）。"""
    return OpenAI(api_key=config.openai_api_key, base_url=config.openai_base_url)


def to_openai_tools(mcp_tools: list) -> list[dict]:
    """把 MCP 工具描述转成 OpenAI function calling 能识别的 tools 参数。

    为什么要这层转换：MCP 协议与 OpenAI 的 tools 描述字段命名不完全一样，
    这里只做字段映射，不丢信息，让 LLM 看得到每个 MCP 工具的名字和入参 schema。
    """
    converted: list[dict] = []
    for tool in mcp_tools:
        converted.append(
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or f"MCP 工具 {tool.name}",
                    "parameters": tool.inputSchema or {"type": "object", "properties": {}},
                },
            }
        )
    return converted


def _tool_result_text(result) -> str:
    """FastMCP 的 CallToolResult 把真正的输出放在 .data 上，统一取成字符串。"""
    return str(getattr(result, "data", ""))


def _assistant_message_with_calls(message: object) -> dict:
    """把 LLM 返回的 message 打包成可追加进对话历史的 assistant 消息，保留 tool_calls。"""
    tool_calls = message.tool_calls or []
    return {
        "role": "assistant",
        "content": message.content or "",
        "tool_calls": [
            {
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.function.name,
                    "arguments": call.function.arguments,
                },
            }
            for call in tool_calls
        ],
    }


def _tool_result_message(call: object, result) -> dict:
    """把一次工具调用结果回填成 role=tool 的消息，供 LLM 二次推理使用。"""
    return {
        "role": "tool",
        "tool_call_id": call.id,
        "name": call.function.name,
        "content": json.dumps({"result": _tool_result_text(result)}, ensure_ascii=False),
    }


async def ask_with_llm(
    mcp_client: Client,
    llm_client: OpenAI,
    config: AppConfig,
    user_prompt: str,
) -> str:
    """让 LLM 在 MCP 工具帮助下回答用户问题，最多循环 max_tool_rounds 轮。"""
    # 1. 先发现当前 MCP 服务端有哪些工具，再转成 LLM 能理解的格式
    openai_tools = to_openai_tools(await mcp_client.list_tools())

    # 2. 组装对话上下文：system 提示 LLM “算术题优先走工具，再用人话回答”
    messages = [
        {
            "role": "system",
            "content": "你是教学演示助手。遇到数学算术问题时优先调用工具（加减乘除），再给出简洁中文答案。",
        },
        {"role": "user", "content": user_prompt},
    ]

    # 3. 循环：LLM 决策 -> 调工具 -> 把结果喂回去 -> 再问 LLM，直到给出最终文本
    # 这里用 asyncio.to_thread 是因为 openai 官方 SDK 是同步阻塞的，直接调用会
    # 卡住事件循环，导致后面的 await mcp_client.call_tool 调度不开，必须丢到工作线程跑。
    for _ in range(config.llm_max_tool_rounds):
        completion = await asyncio.to_thread(
            llm_client.chat.completions.create,
            model=config.openai_model,
            messages=messages,
            tools=openai_tools,
            tool_choice="auto",
            temperature=0,
        )
        message = completion.choices[0].message
        tool_calls = message.tool_calls or []

        # 3a. LLM 没要求调工具 -> 直接就是最终答案
        if not tool_calls:
            return (message.content or "").strip()

        # 3b. LLM 要求调工具 -> 先把它的决策记进历史，再逐个执行 MCP 工具
        messages.append(_assistant_message_with_calls(message))
        for call in tool_calls:
            arguments = json.loads(call.function.arguments or "{}")
            result = await mcp_client.call_tool(call.function.name, arguments)
            messages.append(_tool_result_message(call, result))

    # 4. 超过 max_tool_rounds 仍没定论，返回空字符串（教学 demo 不复杂处理）
    return ""
