from __future__ import annotations

import os
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel

TransportType = Literal["stdio", "sse", "streamable_http"]


class AppConfig(BaseModel):
    """配置 schema。"""

    openai_api_key: str
    openai_base_url: str
    openai_model: str
    mcp_transport: TransportType
    mcp_host: str
    mcp_port: int
    mcp_sse_path: str
    mcp_streamable_path: str
    llm_max_tool_rounds: int

    @classmethod
    def from_env(cls) -> "AppConfig":
        load_dotenv()
        return cls(
            openai_api_key=os.getenv("OPENAI_API_KEY", ""),
            openai_base_url=os.getenv(
                "OPENAI_BASE_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            openai_model=os.getenv("OPENAI_MODEL", "qwen3.5-plus"),
            mcp_transport=os.getenv("MCP_TRANSPORT", "stdio"),
            mcp_host=os.getenv("MCP_HOST", "127.0.0.1"),
            mcp_port=int(os.getenv("MCP_PORT", "8000")),
            mcp_sse_path=os.getenv("MCP_SSE_PATH", "/sse"),
            mcp_streamable_path=os.getenv("MCP_STREAMABLE_PATH", "/mcp"),
            llm_max_tool_rounds=int(os.getenv("LLM_MAX_TOOL_ROUNDS", "3")),
        )
