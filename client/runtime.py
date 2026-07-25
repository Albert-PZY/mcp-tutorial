from __future__ import annotations

import os
from pathlib import Path

from fastmcp import Client
from fastmcp.client.transports.stdio import PythonStdioTransport

from config import AppConfig

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STDIO_SERVER_SCRIPT = PROJECT_ROOT / "server" / "stdio.py"


def create_stdio_client() -> Client:
    """stdio 模式：客户端自己去拉起 server/stdio.py 当子进程，通过标准输入输出通信。

    为什么要传 PYTHONPATH：子进程里会 import config / server.app 等本仓库模块，
    把项目根目录塞进 PYTHONPATH，子进程才能找到这些 import。
    """
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PROJECT_ROOT)
    transport = PythonStdioTransport(
        script_path=STDIO_SERVER_SCRIPT,
        cwd=str(PROJECT_ROOT),
        env=env,
    )
    return Client(transport)


def create_sse_client(config: AppConfig) -> Client:
    """sse 模式：连到一个已经在跑的 HTTP+SSE 服务端（路径由 MCP_SSE_PATH 决定）。"""
    url = f"http://{config.mcp_host}:{config.mcp_port}{config.mcp_sse_path}"
    return Client(url)


def create_streamable_http_client(config: AppConfig) -> Client:
    """streamable_http 模式：连到一个已经在跑的 streamable HTTP 服务端（路径由 MCP_STREAMABLE_PATH 决定）。"""
    url = f"http://{config.mcp_host}:{config.mcp_port}{config.mcp_streamable_path}"
    return Client(url)


def create_mcp_client(config: AppConfig) -> Client:
    """根据 MCP_TRANSPORT 选三种连接方式之一。协议本身（initialize/tools/list/tools/call）完全一致，只是“怎么传数据”不同。"""
    if config.mcp_transport == "stdio":
        return create_stdio_client()
    if config.mcp_transport == "sse":
        return create_sse_client(config)
    return create_streamable_http_client(config)
