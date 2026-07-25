# MCP 教学站点（site/）

一份**纯静态、零构建**的 MCP 教学页面：单页 + 自动渲染 PlantUML 图 + 代码高亮 + 双主题（浅色 / 暗色）。

## 在线版本

部署后通过 GitHub Pages 访问：

```
https://albert-pzy.github.io/mcp-tutorial/
```

由 `.github/workflows/deploy-pages.yml` 自动部署（仓库 Pages Source 已设为 Deploy from a GitHub Actions workflow）。

## 本地预览

任选其一：

```bash
# Python（无需任何依赖）
python -m http.server 8000 --directory site
# 浏览器打开 http://localhost:8000/

# 或 npx
npx http-server site -p 8000
```

## 主题

视觉风格对齐 Claude 官方站点：偏暖米白背景、Claude 珊瑚咖啡色作为强调色、衬线正文 + 等宽代码。
左侧导航底部有 **🌗 主题** 按钮，可在浅色 / 暗色之间切换；偏好持久化在 `localStorage["mcp-theme"]`，
未设置时跟随系统的 `prefers-color-scheme`。首屏前内联脚本会提前设置 `<html data-theme>`，避免刷新闪屏（FOUC）。

## 渲染原理与限制

- **PlantUML 在线渲染**：`assets/plantuml.js` 用浏览器原生 `CompressionStream("deflate-raw")` 压缩源码，
  再按 PlantUML 自有 base64 字母表编码，向官方 `https://www.plantuml.com/plantuml/svg/<encoded>` 请求 SVG，
  内嵌进 `<figure>`。**失败时在同一 `<figure>` 里显示原始 PlantUML 源码 + 错误提示，页面不会空白**。
- **代码高亮**：highlight.js（GitHub Dark 主题作为基础，`style.css` 又在浅 / 暗色下各自重写了 token 颜色）。
  脚本走 jsdelivr CDN，**4 秒内没拿到时自动回退 unpkg**；都失败时代码块以纯文本形式裸露，仍可阅读。
- **外网依赖**：图渲染实际需要能访问 plantuml.com；高亮可能需要能访问 jsdelivr / unpkg。
  离线时图会回退到 PlantUML 源码展示（仍可在本地用任意 PlantUML 工具渲染 `site/diagrams/*.puml` / `docs/*.puml`）。
- **无损放大**：SVG 是矢量，点击任意已渲染的图弹出全屏遮罩，支持滚轮缩放 / 拖拽平移 / 复位 / Esc 关闭，质量不损失。

## 目录结构

```text
site/
|-- index.html            # 单页教学站点（5 章节 + 主题切换）
|-- assets/
|   |-- style.css         # Claude 风格浅 / 暗色主题 + 布局 + zoom overlay
|   `-- plantuml.js       # PlantUML 编码 + 在线渲染 + 无损放大（零依赖）
`-- diagrams/
    |-- architecture.puml
    |-- call_sequence.puml
    |-- process_flow.puml
    |-- transport_comparison.puml
    `-- mcp_vs_function_calling.puml
```

`site/diagrams/` 是 `docs/*.puml` 的**同步副本**，目的是让 Pages 部署时站点自包含（Pages artifact 只上 `site/`）。
修改图请编辑 `docs/<name>.puml`，然后同步覆盖 `site/diagrams/<name>.puml`。

### DOM 契约（图嵌入）

每张图采用如下结构；`assets/plantuml.js` 把内容渲染进外层 `<figure>`：

```html
<figure class="figure-wrap" data-source="diagrams/architecture.puml">
  <pre class="plantuml"></pre>     <!-- 仅作隐藏的源码占位，CSS display:none -->
</figure>
```

**注意**：`data-source` 必须放在 `<figure>` 上（不是内层 `<pre>`），渲染结果也是写入外层 `<figure>`，
内层 `<pre class="plantuml">` 仅作为“源码可见的兜底容器”，CSS 中始终 `display:none`。

## 与 Playwright 测试

`tests/playwright/page.spec.ts` 会在 CI 里跑浏览器测试：

- 打开页面、校验标题与章节锚点存在；
- 断言 PlantUML 块渲染出 `<svg>`（外网不通时走**软断言 + 跳过**，不强制红）；
- 失败时回退到源码展示，断言 figure 里不会再是空白；
- 断言代码块出现 `.hljs` class；
- 图的“无损放大”浮层交互（无图可渲时自动跳过该用例）。

另有零依赖本地脚本 `tests/dom-smoke.cjs`，用一个最小 DOM mock 验证 `plantuml.js` 的成功与离线两条路径。
