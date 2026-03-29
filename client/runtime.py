from __future__ import annotations

import os
from pathlib import Path

from fastmcp import Client
from fastmcp.client.transports.stdio import PythonStdioTransport

from config import AppConfig

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STDIO_SERVER_SCRIPT = PROJECT_ROOT / "server" / "stdio.py"


def create_stdio_client() -> Client:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PROJECT_ROOT)
    transport = PythonStdioTransport(
        script_path=STDIO_SERVER_SCRIPT,
        cwd=str(PROJECT_ROOT),
        env=env,
    )
    return Client(transport)


def create_sse_client(config: AppConfig) -> Client:
    return Client(f"http://{config.mcp_host}:{config.mcp_port}{config.mcp_sse_path}")


def create_streamable_http_client(config: AppConfig) -> Client:
    return Client(f"http://{config.mcp_host}:{config.mcp_port}{config.mcp_streamable_path}")


def create_mcp_client(config: AppConfig) -> Client:
    if config.mcp_transport == "stdio":
        return create_stdio_client()
    if config.mcp_transport == "sse":
        return create_sse_client(config)
    return create_streamable_http_client(config)
