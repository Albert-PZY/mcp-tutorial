# Playwright 浏览器自测 (site/)

CI 会跑这些用例验证教学站点：
- 标题、章节锚点、代码高亮
- PlantUML 在线渲染（外网不通时**软断言**不红）
- 失败时回退到源码展示，非空白
- 图的“无损放大”浮层交互

## 本地跑

```bash
cd tests/
npm install
npx playwright install --with-deps chromium
npm test
```
