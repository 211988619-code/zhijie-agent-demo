# 知阶 Agent 中期 Demo 前端

这是一个离线可运行的 React + Vite 单体 Demo，用本地示例课程资料和规则化 Agent 展示“资料解析 -> 诊断测验 -> 学生掌握画像 -> 自适应问答 -> 知识卡片 -> 复习建议”的闭环。

## 启动

```bash
cd src/frontend
npm install
npm run dev
```

浏览器访问 Vite 输出的本地地址，默认通常为 `http://localhost:5173/`。

## 构建验证

```bash
cd src/frontend
npm run build
```

## Demo 说明

- 当前版本不调用真实 LLM API，不需要 API Key。
- Agent 使用规则化 mock 执行器，固定展示任务识别、概念识别、画像查询、资料检索、策略选择、工具调用、回答生成和复习建议。
- 课程资料使用内置 Markdown 数据，前端会展示“已解析、已切分 chunk、已生成知识点、可检索”的状态。
