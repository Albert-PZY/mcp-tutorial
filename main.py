from __future__ import annotations

import asyncio

from client.llm import ask_with_llm, create_openai_client
from client.runtime import create_mcp_client
from config import AppConfig


async def run_chat(config: AppConfig) -> None:
    llm_client = create_openai_client(config)
    mcp_client = create_mcp_client(config)
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
