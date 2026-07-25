from __future__ import annotations

from fastmcp import FastMCP


def create_mcp_server() -> FastMCP:
    """构建一个 MCP 服务端，并把四个计算器工具挂上去。

    @mcp.tool 的作用：把一个普通 Python 函数登记成 MCP 工具，
    客户端通过 tools/list 就能发现它、通过 tools/call 就能调用它。
    FastMCP 会根据函数签名和类型注解自动生成入参 schema（inputSchema），
    所以这里不需要手写 JSON Schema。
    """
    mcp = FastMCP("Test Server")

    @mcp.tool(
        name="calculator_add",
        title="Calculator Add",
        description="Add two numbers",
    )
    def add(a: int, b: int) -> int:
        return a + b

    @mcp.tool(
        name="calculator_subtract",
        title="Calculator Subtract",
        description="Subtract second number from first number",
    )
    def subtract(a: int, b: int) -> int:
        return a - b

    @mcp.tool(
        name="calculator_multiply",
        title="Calculator Multiply",
        description="Multiply two numbers",
    )
    def multiply(a: int, b: int) -> int:
        return a * b

    @mcp.tool(
        name="calculator_divide",
        title="Calculator Divide",
        description="Divide first number by second number (b must not be zero)",
    )
    def divide(a: int, b: int) -> float:
        # 除数为 0 是算术意义上的非法状态，这里直接抛错让调用方看到
        if b == 0:
            raise ValueError("除数不能为 0")
        return a / b

    return mcp
