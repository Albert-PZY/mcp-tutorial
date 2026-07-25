from __future__ import annotations

import os
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel

# 这三种是本 demo 支持的 MCP 传输方式，类型字面量写在最上面，方便看一眼就明白选项。
TransportType = Literal["stdio", "sse", "streamable_http"]


class AppConfig(BaseModel):
    """集中描述所有运行配置，统一从 .env 读取，避免散落的 os.getenv 调用。"""

    # --- LLM（这里是千问百炼的 OpenAI 兼容接口）---
    openai_api_key: str
    openai_base_url: str
    openai_model: str

    # --- MCP 传输层 ---
    mcp_transport: TransportType      # 三选一，决定客户端和服务端怎么连
    mcp_host: str                     # HTTP 类传输的监听地址
    mcp_port: int                     # HTTP 类传输的监听端口
    mcp_sse_path: str                 # SSE 端点路径
    mcp_streamable_path: str          # streamable HTTP 端点路径

    # --- LLM 行为 ---
    llm_max_tool_rounds: int          # LLM <-> 工具 的最大往返次数，防止无限循环

    @classmethod
    def from_env(cls) -> "AppConfig":
        """从 .env 文件和环境变量加载配置；缺省值用于“开箱就能本地玩”的 stdio 模式。"""
        load_dotenv()
        return cls(
            openai_api_key=os.getenv("OPENAI_API_KEY", ""),
            openai_base_url=os.getenv(
                "OPENAI_BASE_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            openai_model=os.getenv("OPENAI_MODEL", "qwen-plus"),
            mcp_transport=os.getenv("MCP_TRANSPORT", "stdio"),
            mcp_host=os.getenv("MCP_HOST", "127.0.0.1"),
            mcp_port=int(os.getenv("MCP_PORT", "8000")),
            mcp_sse_path=os.getenv("MCP_SSE_PATH", "/sse"),
            mcp_streamable_path=os.getenv("MCP_STREAMABLE_PATH", "/mcp"),
            llm_max_tool_rounds=int(os.getenv("LLM_MAX_TOOL_ROUNDS", "3")),
        )
