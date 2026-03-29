from __future__ import annotations

from config import AppConfig
from server.app import create_mcp_server


def run_server_stdio(config: AppConfig) -> None:
    create_mcp_server().run(transport="stdio", show_banner=False)


def run_server_sse(config: AppConfig) -> None:
    create_mcp_server().run(
        transport="sse",
        host=config.mcp_host,
        port=config.mcp_port,
        path=config.mcp_sse_path,
        show_banner=False,
    )


def run_server_streamable_http(config: AppConfig) -> None:
    create_mcp_server().run(
        transport="streamable-http",
        host=config.mcp_host,
        port=config.mcp_port,
        path=config.mcp_streamable_path,
        show_banner=False,
    )


def run_server_by_transport(config: AppConfig) -> None:
    if config.mcp_transport == "stdio":
        run_server_stdio(config)
    elif config.mcp_transport == "sse":
        run_server_sse(config)
    else:
        run_server_streamable_http(config)
