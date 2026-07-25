# MCP 教学站点（site/）

这是一份**纯静态**零依赖构建的教学页面：单页 + 内嵌 PlantUML 图，浏览器里直接渲染。

## 在线版本

部署后通过 GitHub Pages 访问：

```
https://albert-pzy.github.io/mcp-tutorial/
```

由仓库根目录的 `.github/workflows/deploy-pages.yml` 自动部署。

## 本地预览

任选其一：

```bash
# Python（无需任何依赖）
python -m http.server 8000 --directory site
# 然后浏览器打开 http://localhost:8000/

# 或 npx
npx http-server site -p 8000
```

## 目录结构

```text
site/
|-- index.html            # 单页教学站点（5 个章节）
|-- assets/
|   |-- style.css         # 主题 + 布局 + zoom overlay 样式
|   `-- plantuml.js       # PlantUML 编码 + 渲染 + 无损放大 (零依赖，原生 CompressionStream)
`-- diagrams/
    |-- architecture.puml
    |-- call_sequence.puml
    |-- process_flow.puml
    |-- transport_comparison.puml
    `-- mcp_vs_function_calling.puml
```

`site/diagrams/` 是 `docs/*.puml` 的同步副本，目的是让 Pages 部署时站点自包含（Pages artifact 只上 `site/`）。
修改图请编辑 `docs/<name>.puml`，然后同步覆盖 `site/diagrams/<name>.puml`。

## 渲染原理与限制

- **PlantUML 在线渲染**：`assets/plantuml.js` 用浏览器原生 `CompressionStream("deflate-raw")` 把源码压缩，
  再按 PlantUML 自有 base64 字母表编码，向官方 `https://www.plantuml.com/plantuml/svg/<encoded>` 请求 SVG，
  内嵌进 DOM。失败时显示原始 PlantUML 源码 + 错误提示，页面不会白屏。
- **外网依赖**：图渲染**需要能访问 plantuml.com**。在受限网络下会回退到源码展示。
- **无损放大**：图片内嵌后保留 SVG（矢量），点击任意一张图弹出全屏遮罩，支持：滚轮缩放 / 拖拽平移 / 复位 / Esc 关闭。
- **代码高亮**：用 [highlight.js](https://highlightjs.com/) CDN（GitHub 浅色主题），自动识别 `python / json / bash`。
- 离线情况下用任意本地 PlantUML 工具渲染 `site/diagrams/*.puml`（或 `docs/*.puml`）即可。

## 与 Playwright 测试

仓库 `tests/playwright/page.spec.ts` 会在 CI 里跑浏览器测试：

- 打开页面、校验标题与章节锚点存在；
- 断言 PlantUML 块渲染出 `<svg>`（外网不通时用**软断言**降级，不强制红）；
- 断言代码块出现 `.hljs` class；
- 断言放大浮层点击出现、Esc 关闭。
