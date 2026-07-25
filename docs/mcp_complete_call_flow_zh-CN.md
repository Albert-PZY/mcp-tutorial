# MCP 工具调用完整过程

这篇文档专门解答一个问题：
在这个 demo 里，一个 MCP 工具（`calculator_add`）到底是怎么从“被发现”到“被调用”，最后把结果返回给用户的，端到端走一遍。

看图请到在线教学站点；时序图源码在 [`./call_sequence.puml`](./call_sequence.puml)。

## 1. 先看参与角色

一次完整调用里有 4 个角色：

1. **用户** — 在终端输入问题（例如“帮我算 1+2”）。
2. **客户端程序** — `main.py + client/*`：拿 MCP 连接、和 LLM 交互、转发工具调用。
3. **MCP 服务端** — `server/*`：真正提供工具（`@mcp.tool(name="calculator_add", ...)`）。
4. **LLM** — 判断“要不要用工具、用哪个、传什么参数”。

一句话心智模型：**LLM 想、MCP 传、Tool 做。**

## 2. 关键代码位置

1. `server/app.py` — 用 `@mcp.tool()` 注册四个计算器工具。
2. `server/runtime.py` — 按 `stdio/sse/streamable-http` 启动 FastMCP。
3. `client/runtime.py` — 按 `MCP_TRANSPORT` 创建 MCP `Client`。
4. `client/llm.py` — 工具发现、LLM 决策、工具执行、结果回填。
5. `main.py` — 聊天循环入口，收用户输入、打印最终答案。

## 3. 全流程总览

时序图源码在 `docs/call_sequence.puml`，在线教学站点会自动渲染。
阶段顺序：**握手 → 发现 → 决策 → 执行 → 回填 → 输出**。

## 4. 逐步拆开

### 步骤 A — 服务端先把工具“挂出来”

在 `server/app.py`：
- `mcp = FastMCP("Test Server")`
- `@mcp.tool(name="calculator_add", ...)` 修饰 `add(a: int, b: int) -> int`。

FastMCP 会根据函数签名的类型注解自动生成 `inputSchema`，所以不用手写 JSON Schema。
这一步含义：MCP Server 拥有了可被远程调用的工具，其中一个是 `calculator_add`，入参是整数 `a`、`b`。

### 步骤 B — 建立会话并握手

`main.py` 进入 `async with mcp_client as client` 时：

1. 客户端连服务端（具体方式取决于 `MCP_TRANSPORT`）。
2. 客户端发 JSON-RPC `initialize`，带上 `protocolVersion` + `clientInfo`。
3. 服务端回复它自己的 `protocolVersion` / `capabilities` / `serverInfo`。
4. 客户端发通知 `notifications/initialized`。

完成这步后两边都视为“协议准备好”。

### 步骤 C — 工具发现

`ask_with_llm()` 内的第一件事：
- `await mcp_client.list_tools()` → JSON-RPC `tools/list`。

返回里包含四个 `calculator_*` 工具，每个有 `name / title / description / inputSchema`（可能还有 `outputSchema / _meta`）。

### 步骤 D — 把工具信息交给 LLM 决策

`to_openai_tools(...)` 把 MCP 工具列表转成 OpenAI 的 `tools` 参数，连同用户问题一起发给 LLM。
LLM 返回两种之一：
1. 直接答案（不调工具），或
2. `tool_calls` —— 本例是 `calculator_add(a=1, b=2)`。

### 步骤 E — 客户端执行工具调用

对每个 `tool_call`，客户端调：
- `await mcp_client.call_tool(name, arguments)` → JSON-RPC `tools/call`。

请求体：`{ name: "calculator_add", arguments: {"a": 1, "b": 2} }`。
服务端执行真正的 Python 函数，返回 `CallToolResult`。

### 步骤 F — 把工具结果回填给 LLM

客户端把每个 `CallToolResult` 包成 `role: "tool"` 消息
（带 `tool_call_id`、`name`、`content`）追加到 `messages`，
再调一次 LLM，让模型基于工具结果（`3`）产出最终自然语言回答。

### 步骤 G — 输出给用户

`main.py` 直接打印：`助手：1 + 2 = 3`。
一次完整端到端流程走完。

## 5. 协议层出现的 JSON-RPC 方法

按顺序看，核心操作就这 4 个：

1. `initialize` — 会话握手。
2. `notifications/initialized` — “初始化完成，正式请求可以开始”。
3. `tools/list` — 查询当前可用工具（发现）。
4. `tools/call` — 按名字 + 参数执行某个工具。

记忆口诀：**先握手，再发现，再调用，再回填**。

## 6. 真实抓报文（stdio）

下面是一次本地运行 `list_tools + call_tool(calculator_add)` 时真实抓到的 MCP 报文，按时间顺序。

### 6.1 `initialize`（请求 + 响应）

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": { "name": "mcp", "version": "0.1.0" }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "experimental": {},
      "prompts": { "listChanged": false },
      "resources": { "subscribe": false, "listChanged": false },
      "tools": { "listChanged": true },
      "extensions": { "io.modelcontextprotocol/ui": {} }
    },
    "serverInfo": { "name": "Test Server", "version": "3.1.1" }
  }
}
```

### 6.2 `notifications/initialized`（通知）

```json
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

### 6.3 `tools/list`（请求 + 响应）

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "calculator_add",
        "title": "Calculator Add",
        "description": "Add two numbers",
        "inputSchema": {
          "additionalProperties": false,
          "properties": { "a": { "type": "integer" }, "b": { "type": "integer" } },
          "required": ["a", "b"],
          "type": "object"
        },
        "outputSchema": {
          "properties": { "result": { "type": "integer" } },
          "required": ["result"],
          "type": "object",
          "x-fastmcp-wrap-result": true
        },
        "_meta": { "fastmcp": { "tags": [] } }
      }
      // ...calculator_subtract / calculator_multiply / calculator_divide 结构相同
    ]
  }
}
```

### 6.4 `tools/call`（请求 + 响应）

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "calculator_add",
    "arguments": { "a": 1, "b": 2 }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "3" }],
    "structuredContent": { "result": 3 },
    "isError": false
  }
}
```

## 7. 三种传输下什么变了？

答：**主流程不变，只有“怎么把字节送过去”变了。**

1. `stdio` — 客户端拉起服务端子进程，通过 stdin/stdout 通信。
2. `sse` — 客户端通过 HTTP + Server-Sent Events 连一个长驻服务端。
3. `streamable_http` — 客户端连服务端的 HTTP MCP 端点。

无论哪种传输，步骤都还是：
`initialize → tools/list → tools/call → 把结果回喂 LLM → 输出最终答案`。

## 8. 常见误解

1. **误解：** MCP 自己决定调哪个工具。
   **真相：** LLM 来决定；MCP 只是标准化的传输和执行。

2. **误解：** 只要写了 `@mcp.tool` 就会自动被调。
   **真相：** 客户端必须先 `tools/list` 发现它，LLM 还得真的发出 `tool_call` 才会执行。

3. **误解：** 换传输就得改业务逻辑。
   **真相：** 工具逻辑不变，只有启动/连接方式变。
