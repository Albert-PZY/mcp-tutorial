# MCP Tool Call Complete Process

This document answers one specific question:
In this demo, how does an MCP tool (`calculator_add`) actually go from "discovered" to "called",
and finally return the answer to the user — end to end.

For the visual version see the Live Tutorial Site; the sequence diagram source is
[`./call_sequence.puml`](./call_sequence.puml).

## 1. Roles in one call

There are 4 roles in one complete call:

1. **User** — types a question in the terminal, e.g. "help me calculate 1+2".
2. **Client program** — `main.py + client/*`: holds the MCP connection, talks to the LLM, forwards tool calls.
3. **MCP server** — `server/*`: actually provides the tools (`@mcp.tool(name="calculator_add", ...)`).
4. **LLM** — decides whether a tool is needed, which one, and what arguments to pass.

A useful mental model: **LLM thinks, MCP carries, Tool does.**

## 2. Key code locations

1. `server/app.py` — registers the four calculator tools via `@mcp.tool()`.
2. `server/runtime.py` — starts FastMCP by transport (`stdio/sse/streamable-http`).
3. `client/runtime.py` — creates the MCP `Client` according to `MCP_TRANSPORT`.
4. `client/llm.py` — tool discovery, LLM decision, tool execution, result feedback.
5. `main.py` — chat loop entry; reads input, prints final answer.

## 3. Full sequence at a glance

The full sequence diagram source lives at `docs/call_sequence.puml`; rendered when you open the Live Tutorial Site.
Phase order: **handshake → discovery → decision → execution → feedback → output**.

## 4. Step-by-step

### Step A — Server exposes tools first

In `server/app.py`:
- `mcp = FastMCP("Test Server")`
- `@mcp.tool(name="calculator_add", ...)` wraps `add(a: int, b: int) -> int`.

FastMCP auto-generates `inputSchema` from the function's type hints, so no hand-written JSON Schema is needed.
At this point an MCP Server has remotely-callable tools; one of them is `calculator_add` taking integers `a` and `b`.

### Step B — Connect and handshake

When `main.py` enters `async with mcp_client as client`:

1. Client connects to the server (transport depends on `MCP_TRANSPORT`).
2. Client sends JSON-RPC `initialize` with its `protocolVersion` + `clientInfo`.
3. Server replies with its `protocolVersion`, `capabilities`, `serverInfo`.
4. Client sends notification `notifications/initialized`.

After this both sides are "protocol-ready".

### Step C — Tool discovery

First action inside `ask_with_llm()`:
- `await mcp_client.list_tools()` → JSON-RPC `tools/list`.

Response includes the four `calculator_*` tools, each with
`name / title / description / inputSchema` (and possibly `outputSchema / _meta`).

### Step D — Hand tool info to the LLM for decision

`to_openai_tools(...)` turns the MCP tool list into the OpenAI `tools` argument and sends it to the LLM
together with the user's question. The LLM returns one of:
1. Direct answer (no tool call), or
2. `tool_calls` — here, `calculator_add(a=1, b=2)`.

### Step E — Execute the tool call(s)

For each `tool_call` the client calls:
- `await mcp_client.call_tool(name, arguments)` → JSON-RPC `tools/call`.

Request body: `{ name: "calculator_add", arguments: {"a": 1, "b": 2} }`.
The server runs the actual Python function and returns a `CallToolResult`.

### Step F — Feed tool result back to the LLM

The client wraps each `CallToolResult` as a `role: "tool"` message
(with `tool_call_id`, `name`, `content`) and appends it to `messages`.
Then it calls the LLM again so the model can produce the final natural-language reply
based on the tool execution result (`3`).

### Step G — Output to user

`main.py` just prints: `助手：1 + 2 = 3`.
One complete end-to-end flow is done.

## 5. Which JSON-RPC operations appear at protocol level

In order, exactly these core operations:

1. `initialize` — session handshake.
2. `notifications/initialized` — "initialization done, normal requests can start".
3. `tools/list` — query currently available tools (discovery).
4. `tools/call` — run a tool by name + arguments.

Mnemonic: **Handshake → Discover → Call → Feed back**.

## 6. Real captured payloads (stdio)

Below are real MCP payloads captured from one local run of `list_tools + call_tool(calculator_add)`,
in chronological order.

### 6.1 `initialize` (request + response)

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

### 6.2 `notifications/initialized` (notification)

```json
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

### 6.3 `tools/list` (request + response)

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
      // ...calculator_subtract / calculator_multiply / calculator_divide share the same shape
    ]
  }
}
```

### 6.4 `tools/call` (request + response)

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

## 7. What changes under the three transports?

Answer: **the main flow is identical. Only how bytes are carried changes.**

1. `stdio` — client spawns the server process and talks over stdin/stdout.
2. `sse` — client connects via HTTP + Server-Sent Events to a long-running server.
3. `streamable_http` — client connects to the server's HTTP MCP endpoint.

Regardless of transport the steps stay:
`initialize → tools/list → tools/call → feed result back to the LLM → output final answer`.

## 8. Common misunderstandings

1. **Myth:** MCP automatically decides which tool to call.
   **Reality:** the LLM decides; MCP standardizes transport + execution.

2. **Myth:** if `@mcp.tool` is decorated, it gets called automatically.
   **Reality:** the client must discover it via `tools/list`, then the LLM must emit a `tool_call`.

3. **Myth:** changing transport requires changing business logic.
   **Reality:** tool logic is unchanged; only how the connection starts.
