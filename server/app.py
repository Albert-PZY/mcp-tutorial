from __future__ import annotations

from fastmcp import FastMCP


def create_mcp_server() -> FastMCP:
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
        if b == 0:
            raise ValueError("除数不能为 0")
        return a / b

    return mcp
