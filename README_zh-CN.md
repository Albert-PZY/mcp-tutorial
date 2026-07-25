# MCP 最小交互 Demo

[中文](./README_zh-CN.md) | [English](./README.md) | [🏠 在线教学站点](https://albert-pzy.github.io/mcp-tutorial/)

一个最小化的 MCP（Model Context Protocol）教学 demo：一个 LLM 自动判断并调用
FastMCP 提供的计算器工具（`add/subtract/multiply/divide`），通过标准 MCP 协议拿到结果，再给人类一句答案。

> 这个仓库刻意保持小而清晰。想要更直观的可视化讲解（自动渲染的 PlantUML 图 + 语法高亮代码），请打开**在线教学站点**。

## 这个 demo 学什么

- 客户端和服务端如何通过 `initialize → tools/list → tools/call` 通信。
- 三种传输方式：`stdio`、`sse`、`streamable_http` 的差别。
- Function Calling（LLM 决策）和 MCP（工具传输）怎么配合。

## 这个 demo **不**做什么

- 不是生产级 Agent。没有流式输出、没有异步错误重试、没有多轮记忆。
- 不是工具大全。只放 4 个最简单的计算器工具，目的是看懂协议而不是看工具。

## 项目结构

```text
mcp-tutorial/
|-- main.py                  # 程序入口（客户端交互循环）
|-- config.py                # AppConfig 配置 schema + .env 读取
|-- client/
|   |-- runtime.py           # stdio/sse/streamable_http 客户端连接分发
|   `-- llm.py               # OpenAI 初始化 + 工具发现 + LLM 工具调用循环
`-- server/
    |-- app.py               # FastMCP server + 四个 @mcp.tool 计算器
    |-- runtime.py           # stdio/sse/streamable_http 服务端启动分发
    |-- stdio.py             # stdio 服务端入口
    |-- sse.py               # sse 服务端入口
    `-- streamable_http.py   # streamable_http 服务端入口
```

## 1. 安装

```bash
uv sync
```

## 2. 配置 `.env`

把 `.env.example` 复制为 `.env`，填上你自己的 key：

```env
OPENAI_API_KEY=你的百炼APIKey
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_MODEL=qwen-plus

MCP_TRANSPORT=stdio
MCP_HOST=127.0.0.1
MCP_PORT=8000
MCP_SSE_PATH=/sse
MCP_STREAMABLE_PATH=/mcp
LLM_MAX_TOOL_ROUNDS=3
```

默认用阿里云百炼的 OpenAI 兼容接口；任何 OpenAI 兼容厂商都行。

## 3. 启动

### 3.1 stdio（最简单，单终端）

```bash
uv run python main.py
```

启动后直接输入：

```text
你：帮我算一下 1+2 等于几
助手：1 + 2 = 3
```

输入 `exit` 结束程序。

### 3.2 sse（双终端）

在 `.env` 里设 `MCP_TRANSPORT=sse`。

终端 A（服务端）：

```bash
uv run python -m server.sse
```

终端 B（客户端）：

```bash
uv run python main.py
```

### 3.3 streamable_http（双终端）

在 `.env` 里设 `MCP_TRANSPORT=streamable_http`。

终端 A（服务端）：

```bash
uv run python -m server.streamable_http
```

终端 B（客户端）：

```bash
uv run python main.py
```

## 4. 三种传输一览

| 维度 | `stdio` | `sse` | `streamable_http` |
|---|---|---|---|
| 连接方式 | 本地进程管道 | HTTP + Server-Sent Events | HTTP 请求/响应 |
| 启动复杂度 | 最低（单命令） | 中等（需服务端+客户端） | 中等（需服务端+客户端） |
| 典型场景 | 本地开发 / 演示 | 局域网 / 远程服务 | Web 化部署 |
| 调试体验 | 最直接 | 需看网络连通 | 需看网络连通 |

快速建议：
- 想最快跑通 → `stdio`。
- 想模拟“客户端连远程服务” → `sse` 或 `streamable_http`。
- 多人部署 → 优先 HTTP 形态（`sse` / `streamable_http`）。

三种方式只是“怎么把字节从客户端送到服务端”的区别，协议本身都是 MCP。

## 5. 图示（PlantUML 源码）

仓库里保留的 PlantUML 源都放在 `docs/`：

- [`docs/architecture.puml`](./docs/architecture.puml) — 三层架构图
- [`docs/call_sequence.puml`](./docs/call_sequence.puml) — 完整调用时序图（`1+2`）
- [`docs/process_flow.puml`](./docs/process_flow.puml) — 客户端主流程活动图
- [`docs/transport_comparison.puml`](./docs/transport_comparison.puml) — 三种传输并列对比
- [`docs/mcp_vs_function_calling.puml`](./docs/mcp_vs_function_calling.puml) — MCP 与 Function Calling 职责对比

在线教学站点会在浏览器里自动渲染这些图；想本地预览见 `site/README.md`。

## 6. 延伸阅读

- [MCP 工具调用完整过程](./docs/mcp_complete_call_flow_zh-CN.md) — 逐步从“发现”到“输出”讲解，带真实抓到的 JSON-RPC 报文。

## 7. 约束（见 `AGENTS.md`）

- Python 依赖只用 `uv`；不用 `pip install`。
- 涉密本地放 `.env`（已 gitignore），仓库只留脱敏 `.env.example`。
- 不提交任何真实 `OPENAI_API_KEY` / token / 密码 / 私钥。
