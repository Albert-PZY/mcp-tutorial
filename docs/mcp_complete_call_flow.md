# MCP Tool Call Complete Process

This document focuses on one specific question:
In this demo, how does an MCP tool (`calculator_add`) move from "being discovered" to "being called", and finally return the result to the user?

## 1. First, the roles involved

There are 4 roles in one complete call:

1. User: enters a question in terminal (for example, "help me calculate 1+2").
2. Client program: `main.py + client/*`, responsible for MCP connection, LLM interaction, and forwarding tool calls.
3. MCP server: `server/*`, actually provides tools (for example, `@mcp.tool(name="calculator_add", ...)`).
4. LLM: decides whether a tool is needed, which tool to use, and what arguments to pass.

## 2. Key code locations

1. `server/app.py`: registers `calculator_add/calculator_subtract/calculator_multiply/calculator_divide` with `@mcp.tool()`.
2. `server/runtime.py`: starts FastMCP server by protocol (`stdio/sse/streamable-http`).
3. `client/runtime.py`: creates MCP Client based on configuration.
4. `client/llm.py`: handles tool discovery, LLM decision, tool execution, and result injection.
5. `main.py`: chat loop entry, receives user input and prints final answer.

## 3. Full flow overview (big picture first)

<img src="./mcp_call_sequence.png" alt="MCP tool call sequence" width="780" />

## 4. Step-by-step: what exactly happens at each step

### Step A: Server exposes tools first

In server code (`server/app.py`):

- `mcp = FastMCP("Test Server")`
- `@mcp.tool()` decorates `add(a: int, b: int) -> int` and maps it to tool name `calculator_add`

What this means:
The MCP Server exposes multiple remotely callable tools. In this example, one tool is `calculator_add`, and its input schema requires integer `a` and `b`.

### Step B: Client establishes MCP session and performs handshake

When `main.py` enters `async with mcp_client as client`, connection and initialization are triggered:

1. Client connects to server (transport depends on `MCP_TRANSPORT`).
2. Sends JSON-RPC request: `initialize`
3. After receiving server capability info, sends notification: `notifications/initialized`

After this step, both sides are considered "protocol-ready".

### Step C: Tool discovery first

The first action in `client/llm.py` is:

- `await mcp_client.list_tools()`

Protocol operation:

- JSON-RPC: `tools/list`

The response includes at least:

1. Tool name: `calculator_add` (and other `calculator_*` tools)
2. Input schema (`a` and `b` types)
3. Possibly `outputSchema`, `_meta`, etc. (depends on implementation/version)

### Step D: Pass tool information to the LLM for decision-making

Inside `ask_with_llm()`, MCP tools are converted into the model-recognizable `tools` parameter and sent to the LLM together with:

1. User question (for example, "1+2")
2. Available tool list (including `calculator_add` schema)

Then the LLM returns one of two outcomes:

1. Direct answer (no tool call)
2. `tool_calls` (in this case, call `calculator_add`)

### Step E: Client executes tool calls

If LLM returns `tool_calls`, the client iterates and runs:

- `await mcp_client.call_tool(call.function.name, arguments)`

Protocol operation:

- JSON-RPC: `tools/call`

The request contains:

1. Tool name: `calculator_add`
2. Arguments: `{"a": 1, "b": 2}`

After receiving it, server executes `calculator_add` and returns `CallToolResult`.

### Step F: Feed tool result back to LLM

After client receives `CallToolResult`, it wraps it into a `tool` role message and appends to `messages`:

1. `tool_call_id` (for this call)
2. `name` (tool name)
3. `content` (tool output, such as `3`)

Then it calls LLM again so the model can generate the final natural-language response based on tool execution result.

### Step G: Return to user

`main.py` prints the final text directly:

- `Assistant: 1 + 2 = 3`

At this point, one complete end-to-end flow is done.

## 5. Which MCP operations appear at protocol level

In order, the core operations are exactly these 4:

1. `initialize`: session initialization handshake.
2. `notifications/initialized`: tells server "initialization is done, formal requests can start".
3. `tools/list`: query currently available tools (tool discovery).
4. `tools/call`: execute a specific tool by name and arguments.

You can remember it as one sentence:
**Handshake first, then discovery, then invocation, then feed result back to the model.**

## 6. Real captured payloads (`stdio`)

Below are real MCP payloads captured from one local run of `list_tools + call_tool(calculator_add)` (in chronological order).

### 6.1 initialize (request + response)

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {
      "name": "mcp",
      "version": "0.1.0"
    }
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
      "prompts": {
        "listChanged": false
      },
      "resources": {
        "subscribe": false,
        "listChanged": false
      },
      "tools": {
        "listChanged": true
      },
      "extensions": {
        "io.modelcontextprotocol/ui": {}
      }
    },
    "serverInfo": {
      "name": "Test Server",
      "version": "3.1.1"
    }
  }
}
```

### 6.2 notifications/initialized (notification)

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

### 6.3 tools/list (request + response)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
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
          "properties": {
            "a": {
              "type": "integer"
            },
            "b": {
              "type": "integer"
            }
          },
          "required": [
            "a",
            "b"
          ],
          "type": "object"
        },
        "outputSchema": {
          "properties": {
            "result": {
              "type": "integer"
            }
          },
          "required": [
            "result"
          ],
          "type": "object",
          "x-fastmcp-wrap-result": true
        },
        "_meta": {
          "fastmcp": {
            "tags": []
          }
        }
      },
      {
        "name": "calculator_subtract",
        "title": "Calculator Subtract",
        "description": "Subtract second number from first number",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {
            "a": {
              "type": "integer"
            },
            "b": {
              "type": "integer"
            }
          },
          "required": [
            "a",
            "b"
          ],
          "type": "object"
        },
        "outputSchema": {
          "properties": {
            "result": {
              "type": "integer"
            }
          },
          "required": [
            "result"
          ],
          "type": "object",
          "x-fastmcp-wrap-result": true
        },
        "_meta": {
          "fastmcp": {
            "tags": []
          }
        }
      },
      {
        "name": "calculator_multiply",
        "title": "Calculator Multiply",
        "description": "Multiply two numbers",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {
            "a": {
              "type": "integer"
            },
            "b": {
              "type": "integer"
            }
          },
          "required": [
            "a",
            "b"
          ],
          "type": "object"
        },
        "outputSchema": {
          "properties": {
            "result": {
              "type": "integer"
            }
          },
          "required": [
            "result"
          ],
          "type": "object",
          "x-fastmcp-wrap-result": true
        },
        "_meta": {
          "fastmcp": {
            "tags": []
          }
        }
      },
      {
        "name": "calculator_divide",
        "title": "Calculator Divide",
        "description": "Divide first number by second number (b must not be zero)",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {
            "a": {
              "type": "integer"
            },
            "b": {
              "type": "integer"
            }
          },
          "required": [
            "a",
            "b"
          ],
          "type": "object"
        },
        "outputSchema": {
          "properties": {
            "result": {
              "type": "number"
            }
          },
          "required": [
            "result"
          ],
          "type": "object",
          "x-fastmcp-wrap-result": true
        },
        "_meta": {
          "fastmcp": {
            "tags": []
          }
        }
      }
    ]
  }
}
```

### 6.4 tools/call (request + response)

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "calculator_add",
    "arguments": {
      "a": 1,
      "b": 2
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "3"
      }
    ],
    "structuredContent": {
      "result": 3
    },
    "isError": false
  }
}
```

## 7. What changes under three transports?

Answer: **The main flow stays the same. Only connection mode changes.**

1. `stdio`
Client starts and connects server process through standard input/output.

2. `sse`
Client connects to an already-running server via HTTP + SSE.

3. `streamable_http`
Client connects to server's streamable endpoint via HTTP.

No matter which transport you use, the steps remain:

1. initialize
2. tools/list
3. tools/call
4. feed result back to LLM
5. output final answer

## 8. Common misunderstandings

1. Misunderstanding: MCP automatically decides which tool to call.  
Reality: the decision is usually made by LLM; MCP standardizes communication and execution.

2. Misunderstanding: once `@mcp.tool` exists, it will be called automatically.  
Reality: client must discover it via `tools/list`, then LLM must generate `tool_call`.

3. Misunderstanding: changing transport requires changing business logic.  
Reality: usually tool logic stays unchanged; only connection/startup mode changes.
