# 知阶 Agent

> 面向大学生课程学习与复习管理的 AI Agent 原型，围绕“资料—知识点—问答—测验—掌握度—错题与复习”构建学习闭环。

## 项目定位

- AI Agent 训练营中期评审 Demo，重点验证学习管理 Agent 的核心工作流。
- 前端技术栈：React + TypeScript + Vite。
- 当前为前端 MVP，主要状态使用 React state 与 `localStorage` 保存。
- 支持真实 OpenAI-compatible LLM API，也保留 mock / fallback 演示能力。

## 当前已实现功能

### 已可用

- 资料上传、文本解析、chunk 切分与概念提取。
- 知识点确认、忽略、移除，以及知识卡片查看与管理。
- Materials、Assistant、Quiz、Review、Agent Trace、完整错题页等入口。
- API Key、Base URL、Model 配置与真实 LLM Chat。
- 将相关资料片段注入 Chat Prompt 的资料问答。
- 按知识点生成 Quiz、自动判题、更新 Mastery 掌握度画像。
- 错题收集、错题练习、复习任务创建与状态更新。
- Agent Trace 展示检测、评估、掌握度更新和复习调度过程。

### Mock / fallback

- 无 API Key、API 调用失败或题目解析失败时，可使用内置问答或 Quiz fallback。
- 当前资料检索为简化版关键词匹配与 prompt 注入，不是完整 RAG。

### 开发中

- DDL 驱动的学习计划、任务进度追踪与动态调整。
- 后端持久化、用户系统、多课程和多资料管理。

## 从原始 Demo 到当前版本的主要改动

1. **UI 信息架构重构**：将原本堆叠在一个页面的功能拆分为 Dashboard、Materials、Assistant、Quiz、Review、Agent Trace 等工作区入口。
2. **功能入口恢复**：恢复 ChatWindow、知识卡片、错题、复习、模型设置和完整错题页入口。
3. **真实 LLM Chat**：ModelSettings 中的 API Key、Base URL、Model 配置可以实际影响 Chat，并支持 mock fallback。
4. **资料上下文问答**：上传资料后生成 chunks，通过简化关键词检索将相关片段注入 Chat Prompt。
5. **Materials 知识库管理**：分区展示资料、知识点、知识卡片和 RAG 状态，支持确认、忽略、移除、加入复习和知识检测。
6. **Quiz / Review / Mastery 闭环**：知识检测后自动判题、更新掌握度、收集错题、创建或更新复习任务，并记录 Agent Trace。
7. **启动体验**：新增 Windows 与 macOS / Linux 一键启动脚本，自动处理依赖、构建、浏览器打开和 `5173` 端口冲突。

## 中期评审建议演示链条

```text
上传资料
→ 导入 / 确认知识点
→ 加入复习
→ 知识检测 / Quiz
→ 自动判题
→ 更新 Mastery
→ 错题与复习任务
→ Agent Trace 展示执行过程
```

## 快速启动

### 一键启动

脚本位于 `frontend/`，会在需要时安装依赖、执行构建，并从 `5173` 开始寻找可用端口。

```bash
# Windows
cd frontend
start.bat

# macOS / Linux
cd frontend
chmod +x start.sh
./start.sh
```

### 手动启动

```bash
cd frontend
npm install
npm run dev
```

Vite 默认地址通常为 `http://localhost:5173/`；端口被占用时会使用下一个可用端口。

## 配置真实 LLM

1. 打开页面中的“模型设置”。
2. 填写 API Key、Base URL 和 Model。
3. 保存并测试连接。
4. 进入“问 AI Agent”页面开始 Chat。

当前支持 OpenAI-compatible API。无 API Key 或调用失败时，可能使用 mock fallback。API Key 仅适合本地 Demo，生产环境不应由浏览器直接保存或调用。

## 新增或重要文件

```text
frontend/start.bat                              Windows 一键启动脚本
frontend/start.sh                               macOS / Linux 一键启动脚本
frontend/src/App.tsx                            应用状态与主要工作流入口
frontend/src/components/dashboard/DashboardPage.tsx
frontend/src/components/layout/AppShell.tsx     工作台整体布局
frontend/src/components/layout/Sidebar.tsx      工作区导航
frontend/src/components/layout/RightSummaryPanel.tsx
frontend/src/components/materials/MaterialsPage.tsx
frontend/src/components/ChatWindow.tsx          AI Agent Chat
frontend/src/components/ModelSettings.tsx       LLM 配置
frontend/src/components/QuizPanel.tsx           能力评估与知识检测
frontend/src/components/MistakesPage.tsx        完整错题页
frontend/src/components/ReviewTaskPanel.tsx     复习任务
frontend/src/services/llmClient.ts              OpenAI-compatible LLM 调用
frontend/src/services/retrievalService.ts       简化版资料片段检索
```

## 当前限制

- 当前是前端 MVP，状态主要保存在 `localStorage`。
- 资料解析、chunk 切分和 Quiz 题目质量仍有限。
- 当前不是完整 RAG，没有 embedding、向量数据库或后端检索服务。
- 部分流程仍依赖 mock / fallback。
- 尚未接入后端、数据库和用户系统。
- 浏览器直连 LLM API 可能存在 CORS 与 API Key 安全风险。

## 后续计划

- DDL 驱动学习计划与任务拆解。
- 根据完成情况动态调整计划。
- 完整 RAG、向量检索与多资料管理。
- FastAPI 后端与 SQLite / PostgreSQL 持久化。
- 多课程、用户画像和 Quiz 题目质量优化。
- 增强 Planner、Evaluator、Scheduler、Reflector 等 Agent workflow 的真实性。
