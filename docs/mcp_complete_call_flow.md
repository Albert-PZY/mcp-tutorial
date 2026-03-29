# MCP 工具调用完整过程

这篇文档专门解释一个问题：  
在这个 demo 里，一个 MCP 工具（`calculator_add`）到底是怎么从“被发现”到“被调用”，最后把结果返回给用户的。

## 1. 先看参与角色

一次完整调用里有 4 个角色：

1. 用户：在终端输入问题（例如“帮我算 1+2”）。
2. 客户端程序：`main.py + client/*`，负责连 MCP、调 LLM、转发工具调用。
3. MCP 服务端：`server/*`，真正提供工具（`@mcp.tool(name=\"calculator_add\", ...)`）。
4. LLM：负责判断“要不要用工具、用哪个工具、传什么参数”。

## 2. 关键代码位置

1. `server/app.py`：用 `@mcp.tool()` 注册 `calculator_add/calculator_subtract/calculator_multiply/calculator_divide`。
2. `server/runtime.py`：按协议启动 FastMCP 服务（`stdio/sse/streamable-http`）。
3. `client/runtime.py`：按配置创建 MCP Client。
4. `client/llm.py`：工具发现、LLM 决策、调用工具、回填结果。
5. `main.py`：聊天循环入口，接收用户输入并输出最终答案。

## 3. 全流程总览（先看大图）

<img src="./mcp_call_sequence.png" alt="MCP 工具调用时序图" width="780" />

## 4. 逐步拆开：每一步到底做了什么

### 步骤 A：服务端先把工具“挂出来”

服务端代码（`server/app.py`）里：

- `mcp = FastMCP("Test Server")`
- `@mcp.tool()` 修饰 `add(a: int, b: int) -> int`，并映射为工具名 `calculator_add`

这一步的含义是：  
MCP Server 拥有可被远程调用的多个工具，其中示例工具名是 `calculator_add`，输入 schema 为整数 `a`、`b`。

### 步骤 B：客户端建立 MCP 会话并握手

在 `main.py` 里进入 `async with mcp_client as client` 时，会触发连接和初始化：

1. 客户端连上服务端（具体传输由 `MCP_TRANSPORT` 决定）。
2. 发送 JSON-RPC 请求：`initialize`
3. 收到服务端能力信息后，发送通知：`notifications/initialized`

这一步做完，双方才算“协议层已就绪”。

### 步骤 C：先做工具发现（Discovery）

`client/llm.py` 的第一步是：

- `await mcp_client.list_tools()`

对应协议操作是：

- JSON-RPC：`tools/list`

拿到的内容里至少会有：

1. 工具名：`calculator_add`（以及其它 `calculator_*` 工具）
2. 输入参数 schema（`a`、`b` 的类型）
3. 可能还会有 `outputSchema`、`_meta` 等字段（取决于实现与版本）

### 步骤 D：把工具信息交给 LLM 做决策

`ask_with_llm()` 里会把 MCP tools 转成模型可识别的 `tools` 参数，发给 LLM：

1. 用户问题（例如“1+2”）
2. 可用工具列表（包含 `calculator_add` 的 schema）

然后 LLM 输出二选一结果：

1. 直接回答（不调工具）
2. 产出 `tool_calls`（本例就是调用 `calculator_add`）

### 步骤 E：客户端执行工具调用

如果 LLM 返回 `tool_calls`，客户端会遍历调用：

- `await mcp_client.call_tool(call.function.name, arguments)`

对应协议操作是：

- JSON-RPC：`tools/call`

请求里包含：

1. 工具名：`calculator_add`
2. 参数：`{"a": 1, "b": 2}`

服务端收到后，执行 `calculator_add` 并返回 `CallToolResult`。

### 步骤 F：把工具结果回填给 LLM

客户端拿到 `CallToolResult` 后，会把结果包装成一条 `tool` 角色消息追加到 `messages`：

1. `tool_call_id`（对应这次调用）
2. `name`（工具名）
3. `content`（工具输出，比如 `3`）

然后再次调用 LLM，让它基于“工具执行结果”产出最终自然语言回答。

### 步骤 G：输出给用户

`main.py` 拿到最终文本后直接打印：

- `助手：1 + 2 = 3`

到这里一次完整链路结束。

## 5. 协议层会看到哪些 MCP 操作

按发生顺序，核心就是这 4 类：

1. `initialize`：会话初始化握手。
2. `notifications/initialized`：告诉服务端“初始化完成，可以正式收发业务请求”。
3. `tools/list`：查询当前可用工具（工具发现）。
4. `tools/call`：按工具名+参数执行具体工具。

可以把它记成一句话：  
**先握手，再发现，再调用，再把结果回填给模型。**

## 6. 真实运行抓取报文（本项目，`stdio`）

下面是本地真实跑一次 `list_tools + call_tool(calculator_add)` 抓到的 MCP 报文（按发生顺序）。  

### 6.1 initialize（请求 + 响应）

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

### 6.2 notifications/initialized（通知）

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

### 6.3 tools/list（请求 + 响应）

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

### 6.4 tools/call（请求 + 响应）

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

## 7. 三种传输协议下，这个流程有什么变化？

答案：**主流程不变，只是“连接方式”不同。**

1. `stdio`
客户端通过标准输入输出启动并连接服务端进程。最适合本地教学。

2. `sse`
客户端通过 HTTP + SSE 连已经运行的服务端。

3. `streamable_http`
客户端通过 HTTP 连服务端的 streamable 路径。

无论哪种 transport，步骤仍是：

1. initialize
2. tools/list
3. tools/call
4. 回填结果给 LLM
5. 输出最终答案

## 8. 常见误区

1. 误区：MCP 会自动替你“决定调用哪个工具”。
实际：决定通常是 LLM 做的；MCP 负责标准化通信和执行。

2. 误区：有 `@mcp.tool` 就会自动被调用。
实际：还要客户端先 `tools/list` 发现它，再由 LLM 产生 `tool_call`。

3. 误区：换协议会改业务逻辑。
实际：一般不用改工具逻辑，只改连接/启动方式。
