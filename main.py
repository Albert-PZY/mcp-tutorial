from __future__ import annotations

import asyncio

from client.llm import ask_with_llm, create_openai_client
from client.runtime import create_mcp_client
from config import AppConfig


async def run_chat(config: AppConfig) -> None:
    """交互式对话主循环：读用户输入 -> 让 LLM 借 MCP 工具回答 -> 打印回复。"""
    llm_client = create_openai_client(config)
    mcp_client = create_mcp_client(config)

    # async with 进入时会完成 MCP 会话握手：
    # 客户端 -> 服务端 initialize，再发 notifications/initialized。
    async with mcp_client as client:
        print("输入问题开始对话，输入 exit 退出。")
        while True:
            user_prompt = input("你：").strip()
            if user_prompt == "exit":
                print("已退出。")
                return
            answer = await ask_with_llm(client, llm_client, config, user_prompt)
            print(f"助手：{answer}")


def main() -> None:
    asyncio.run(run_chat(AppConfig.from_env()))


if __name__ == "__main__":
    main()
