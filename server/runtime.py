from __future__ import annotations

from config import AppConfig
from server.app import create_mcp_server


def run_server_stdio(config: AppConfig) -> None:
    """stdio 启动：进程把工具暴露在自家标准输入输出上，方便客户端当子进程直接拉起。"""
    create_mcp_server().run(transport="stdio", show_banner=False)


def run_server_sse(config: AppConfig) -> None:
    """sse 启动：长驻为 HTTP+SSE 服务端，供远程客户端通过 /sse 连过来。"""
    create_mcp_server().run(
        transport="sse",
        host=config.mcp_host,
        port=config.mcp_port,
        path=config.mcp_sse_path,
        show_banner=False,
    )


def run_server_streamable_http(config: AppConfig) -> None:
    """streamable_http 启动：做成一个标准的 HTTP MCP 端点，适合 Web 化部署。"""
    create_mcp_server().run(
        transport="streamable-http",
        host=config.mcp_host,
        port=config.mcp_port,
        path=config.mcp_streamable_path,
        show_banner=False,
    )


def run_server_by_transport(config: AppConfig) -> None:
    """根据 MCP_TRANSPORT 选三种传输启动方式之一。三种方式下工具集合完全一致，差别只在传输层。"""
    if config.mcp_transport == "stdio":
        run_server_stdio(config)
    elif config.mcp_transport == "sse":
        run_server_sse(config)
    else:
        run_server_streamable_http(config)
