# MCP Minimal Interactive Demo

[中文](./README_zh-CN.md) | English | [🏠 Live Tutorial Site](https://albert-pzy.github.io/mcp-tutorial/)

A minimal MCP (Model Context Protocol) teaching demo: an LLM automatically picks and calls
FastMCP calculator tools (`add/subtract/multiply/divide`) through the standard MCP protocol,
and returns a natural-language answer.

> This repo is deliberately small and readable. For a richer visual walkthrough
> (auto-rendered PlantUML diagrams + syntax-highlighted code) open the **Live Tutorial Site**.

## What you will learn

- How an MCP client and server talk via `initialize → tools/list → tools/call`.
- The three transport options: `stdio`, `sse`, `streamable_http`.
- How Function Calling (LLM decision) and MCP (tool transport) cooperate.

## What this demo is **not**

- Not a production agent. No streaming, no async error retry, no multi-turn memory.
- Not a tool catalog. It only ships 4 trivially-simple calculator tools on purpose.

## Project structure

```text
mcp-tutorial/
|-- main.py                  # Entry: interactive chat loop (client)
|-- config.py                # AppConfig schema + .env loading
|-- client/
|   |-- runtime.py           # MCP client transport routing (stdio/sse/streamable_http)
|   `-- llm.py               # OpenAI init + tool-discovery + LLM tool-calling loop
`-- server/
    |-- app.py               # FastMCP server + four @mcp.tool calculators
    |-- runtime.py           # MCP server transport routing
    |-- stdio.py             # stdio server entry
    |-- sse.py               # sse server entry
    `-- streamable_http.py   # streamable_http server entry
```

## 1. Install

```bash
uv sync
```

## 2. Configure `.env`

Copy `.env.example` to `.env` and set your own key:

```env
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_MODEL=qwen-plus

MCP_TRANSPORT=stdio
MCP_HOST=127.0.0.1
MCP_PORT=8000
MCP_SSE_PATH=/sse
MCP_STREAMABLE_PATH=/mcp
LLM_MAX_TOOL_ROUNDS=3
```

This demo uses Alibaba Cloud Bailian's OpenAI-compatible endpoint by default;
any OpenAI-compatible provider works.

## 3. Run

### 3.1 stdio (simplest, one terminal)

```bash
uv run python main.py
```

Then just chat:

```text
你：help me calculate 1 + 2
助手：1 + 2 = 3
```

Type `exit` to quit.

### 3.2 sse (two terminals)

In `.env` set `MCP_TRANSPORT=sse`.

Terminal A (server):

```bash
uv run python -m server.sse
```

Terminal B (client):

```bash
uv run python main.py
```

### 3.3 streamable_http (two terminals)

In `.env` set `MCP_TRANSPORT=streamable_http`.

Terminal A (server):

```bash
uv run python -m server.streamable_http
```

Terminal B (client):

```bash
uv run python main.py
```

## 4. Three transports at a glance

| Aspect | `stdio` | `sse` | `streamable_http` |
|---|---|---|---|
| Connection | Local process pipe | HTTP + Server-Sent Events | HTTP request/response |
| Startup | One command | server + client | server + client |
| Typical use | Local dev / teaching | LAN / remote service | Web-style deployment |
| Debug feel | Most direct | Need network reachability | Need network reachability |

Quick pick:
- Fastest path → `stdio`.
- "Client talks to a remote service" → `sse` or `streamable_http`.
- Multi-user deployment → HTTP form (`sse` / `streamable_http`).

The protocol is the same MCP in all three cases; only how bytes get from
client to server changes.

## 5. Diagrams (PlantUML source)

Repo-kept PlantUML sources live in `docs/`:

- [`docs/architecture.puml`](./docs/architecture.puml) — three-layer architecture
- [`docs/call_sequence.puml`](./docs/call_sequence.puml) — full call sequence (`1+2`)
- [`docs/process_flow.puml`](./docs/process_flow.puml) — client process flow
- [`docs/transport_comparison.puml`](./docs/transport_comparison.puml) — three transports side by side
- [`docs/mcp_vs_function_calling.puml`](./docs/mcp_vs_function_calling.puml) — MCP vs Function Calling

The Live Tutorial Site renders these in-browser; see `site/README.md` if you prefer local preview.

## 6. Further reading

- [MCP complete call flow (EN)](./docs/mcp_complete_call_flow.md) — step-by-step from discovery to final answer, with real captured JSON-RPC payloads.

## 7. Constraints (see `AGENTS.md`)

- Python deps via `uv` only; no `pip install`.
- Encrypt secrets: `.env` is git-ignored; `.env.example` uses placeholders only.
- No real `OPENAI_API_KEY` / token / secret in any committed file.
