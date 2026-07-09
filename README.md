<div align="center">

# 邻里圈 · Linli Circle

*一个平台，四种连接 — 有温度的社区互助生态平台*

**现代城镇时，邻里不再来往**。我们用 AI 技术重建连接。

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING) <!-- 可按需启用 -->

[English](./docs/README.en.md) · 中文 ·
[Code Wiki](./docs/CODE_WIKI.md) ·
[用户手册](./docs/用户手册.md) ·
[部署运维手册](./docs/部署运维手册.md)

</div>

---

给 TRAE AI 创造力大赛「社会服务/造种新体验」赛道（主题：「世界很大，放手去造」）。
需要英文版本时，请创建 `docs/README.en.md`；上述链接在您创建之前会显示为占位。

---

## 🌐 在线访问

**生产环境**：[https://community.niuzi.asia](https://community.niuzi.asia)

---

## 🤖 Agent 自动维护

本项目由 **TRAE AI Agent 自驱迭代** 自动维护，遵循专属定时任务规范进行无人值守的持续开发、健康校验与进度沉淀。

- **规范文件**：[`docs/auto-iteration-spec.md`](./docs/auto-iteration-spec.md)（v1.3 最终稳定版）
- **项目路径**：`e:\work/auto-community`（Monorepo 架构，所有操作仅限该目录）
- **进度记忆**：`e:\work/auto-community\memory\` 目录，按日期存放 `topics.md` 跨轮次延续进度
- **调度模式**：定时触发，单次调度上限 4 小时（3.5 小时强制收尾），每轮完成 1–2 个最小可交付单元
- **六步闭环**：健康度预检 → 动态规划 → 小步编码 → 全量验收 → 计划复盘 → 进度沉淀
- **健康校验**：后端 `npx tsc --noEmit && npx vitest run`，前端 `npm run build`，校验不通过禁止新功能开发
- **全局优先级**：Phase1 收尾 → 项目健康故障修复 → Phase2 核心功能开发 → 技术债清理 → 样式精修 → 测试补全
- **阶段锁定**：Phase 1 收尾任务未全部验收通过前，禁止启动 Phase 2 完整功能开发
- **Git 规范**：每个最小修改单元通过后立即 `git add`（仅本次文件）→ `git commit` → `git push origin HEAD`，提交信息使用中文（`feat/fix/refactor/docs: 描述`），禁止 force push、reset --hard 等破坏性命令
- **资源白名单**：仅可使用 `https://trae-api-cn.most.guru/api/ide/v1/text_to_image` 生成装饰/占位图，核心业务素材优先 SVG / CSS / 内置图标库
- **运行风格**：默默干活，不主动通知用户；需用户介入的阻塞问题统一放在摘要「遗留问题」中

> 定时任务指令优先级 > 规范默认值 > 开发规划文档（development-plan.md）。

---

## 概览

随着城市化进程加快，邻里关系逐渐疏远：独居青年与空巢老人缺乏社交、每家每户重复购买工具设备、紧急时刻需要邻居帮助却缺乏连接渠道、很多人有技能但没有分享的平台。

**邻里圈（Linli Circle / Neighborhood Circle）** 是一个 AI 驱动的社区互助平台，通过**四大业务模块**重建邻里连接、实现资源互助。

| 模块 | 核心功能 | 社会价值 |
| --- | --- | --- |
| **技能交换 Skill Exchange** | 技能发布 · AI 语义匹配 · 订单与积分结算 · 纠纷裁决 | 让每份价值被看见 |
| **共享厨房 Shared Kitchen** | 美食分享 · 拼单 · 订单预约 · 过敏原标注 | 重建邻里烟火气 |
| **时间银行 Time Bank** | 时间存取 · 代际互助 · 亲情绑定 · 防并发安全 | 跨代互助养老 |
| **应急邻里 Emergency Neighbor** | 匿名求助 · WebSocket 实时推送 · ETA 追踪 · 超时回退 | 关键时刻靠邻居 |

---

## 特性

- 🧠 **AI 智能匹配** — 兼容 OpenAI / 通义千问 / 智谱 Chat Completions 协议，语义+距离+信誉三维推荐；AI 不可用时自动降级为规则匹配
- 💬 **实时通讯** — 基于 WebSocket 的紧急求助推送、消息通知与响应追踪
- 🛡️ **安全合规** — JWT 双 Token · PII AES-256-GCM 加密 · bcrypt 哈希 · 限流 · CORS · XSS 过滤
- 📊 **可观测性** — Pino 结构化日志 · Swagger 交互 API 文档 · 完整审计日志链
- 🗺️ **地图集成** — 高德地图 API 支持地理编码、距离计算、应急资源地图
- 🔐 **权限分级** — 普通用户/管理员双角色，水平权限校验，JWT 黑名单
- 💰 **事务安全** — 资产变更走数据库事务 + `FOR UPDATE` 行锁 + 幂等控制
- 🤝 **第三方集成** — 阿里云 OSS · 阿里/腾讯云短信 · 邮件通知 · Redis 缓存
- 📱 **多端适配** — React 响应式 Web（Vite + TailwindCSS）
- 📦 **容器化** — Docker Compose 一键编排 PostgreSQL + Redis + Server + Client
- 🤖 **自动迭代** — 内置 TRAE AI 自动迭代规范（`docs/auto-iteration-spec.md`）

---

## 技术栈

| 层级 | 技术方案 | 说明 |
| --- | --- | --- |
| 前端 | React 18 · TypeScript 5 · Vite · TailwindCSS 4 | 组件化、类型安全、极速 HMR |
| 状态 | Zustand 5 | 轻量全局状态 |
| HTTP | Axios | API 调用层 |
| 后端 | Node.js 20 · Express 4 · TypeScript 5 | 高性能异步框架 |
| 数据库 | PostgreSQL 16 | 关系型存储，`node-pg-migrate` 增量迁移 |
| 缓存 | Redis 7 | 高频缓存、会话、限流、Token 黑名单 |
| 实时 | WebSocket (ws) | 紧急推送与实时消息 |
| 鉴权 | JWT · bcrypt · helmet · express-rate-limit | 多层安全防护 |
| AI | 兼容 OpenAI Chat Completions 协议 | 智能匹配与需求理解 |
| 地图 | 高德地图 API | 定位与距离计算 |
| 存储 | 阿里云 OSS | 图片/文件上传 |
| 通知 | 阿里/腾讯云短信 · nodemailer 邮件 | 验证码与通知 |
| 文档 | Swagger (swagger-jsdoc + swagger-ui-express) | 交互式 API 文档 |
| 日志 | Pino | 高性能结构化日志 |
| 测试 | Vitest · Testing Library | 单元测试与覆盖率 |
| 部署 | Docker Compose · GitHub Actions | 一键容器化 + CI |

---

## 快速开始

### 环境要求

- Node.js ≥ 20
- PostgreSQL ≥ 14
- Redis ≥ 6
- （可选）Docker ≥ 24 · Docker Compose ≥ 2

### 一键启动（Docker Compose，推荐）

```bash
git clone <repo-url> && cd auto-community
cp .env.example .env          # 编辑 .env，至少填写 JWT_SECRET / DB_PASSWORD / REDIS_PASSWORD / PII_ENCRYPT_KEY
docker compose up -d
# 前端 http://localhost  ·  API http://localhost:3000/api  ·  Swagger http://localhost:3000/api-docs
```

> ⚠️ 生产环境 `CORS_ORIGIN` 不可使用 `localhost`，请填写实际访问地址。

### 本地开发

```bash
npm install                   # 安装根目录 concurrently

# 终端 1：后端热重载（http://localhost:3000）
npm run dev:server

# 终端 2：前端 Vite（http://localhost:5173）
npm run dev:client

# 数据库迁移
npm run db:migrate

# 一次性启动前后端
npm run dev

# 构建
npm run build

# 测试
cd server && npm run test
cd client && npm run test
```

### 关键环境变量

复制 `.env.example` 为 `.env` 后，必须配置以下变量（详见 `.env.example` 注释）：

| 变量 | 必填环境 | 用途 |
| --- | --- | --- |
| `NODE_ENV` | 全部 | `development` / `test` / `production` |
| `PORT` | 全部 | 后端端口（默认 `3000`） |
| `DB_*` | 全部 | PostgreSQL 连接信息 |
| `REDIS_*` | 全部 | Redis 连接信息 |
| `JWT_SECRET` | 全部 | JWT 签名密钥，生产务必使用高强度随机串 |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | 全部 | Access/Refresh Token 过期时间 |
| `CORS_ORIGIN` | 生产必填 | 允许的前端来源，生产不可为 `localhost` |
| `PII_ENCRYPT_KEY` | 生产必填 | PII 加密密钥（32 字节 hex，一旦配置不可更改） |
| `AI_API_KEY` / `AI_API_BASE` / `AI_MODEL` | 可选 | AI 智能匹配，留空则降级为规则匹配 |
| `AMAP_KEY` | 可选 | 高德地图 API Key |

---

## 目录结构

```
auto-community/
├── client/                  # 前端（React + Vite + TailwindCSS）
│   ├── src/
│   │   ├── api/             # Axios API 调用层
│   │   ├── components/      # 公共组件（AI、图表、地图、上传…）
│   │   ├── hooks/           # 自定义 Hooks
│   │   ├── pages/           # 页面：Auth / Home / SkillExchange / SharedKitchen /
│   │   │                    #        TimeBank / Emergency / Admin / Profile …
│   │   ├── stores/          # Zustand 状态管理
│   │   ├── types/           # TypeScript 类型定义
│   │   └── utils/           # 工具函数
│   └── nginx.conf           # 前端 Nginx 配置
├── server/                  # 后端（Express + TypeScript）
│   ├── src/
│   │   ├── config/          # 配置（env / database / redis / swagger）
│   │   ├── middleware/      # 中间件（auth / validator / rateLimiter / upload / auditLog）
│   │   ├── migrations/      # 数据库迁移（TypeScript 版，20+ 文件）
│   │   ├── jobs/            # 定时任务（订单超时、备份）
│   │   └── index.ts         # 入口
│   └── Dockerfile
├── database/
│   └── migrations/          # 原始 SQL 迁移（001~023，幂等）
├── docs/                    # 项目文档
│   ├── project-spec.md      # 项目规格说明
│   ├── development-plan.md  # 开发规划
│   ├── CODE_WIKI.md         # 代码百科
│   ├── 用户手册.md
│   ├── 部署运维手册.md
│   └── modules/             # 各模块设计文档
├── .env.example             # 环境变量样例
├── docker-compose.yml       # 一键编排：postgres + redis + server + client
└── package.json             # Monorepo 根（client + server workspace）
```

---

## 部署

### 方案 A：Docker Compose（推荐）

```bash
cp .env.example .env
# 编辑 .env 填写生产环境密钥
docker compose up -d
```

| 服务 | 容器名 | 端口 | 用途 |
| --- | --- | --- | --- |
| PostgreSQL | `linli-postgres` | 5432 | 主数据库 |
| Redis | `linli-redis` | 6379 | 缓存与会话 |
| Server | `linli-server` | 3000 | REST API |
| Client | `linli-client` | 80 | 前端静态资源（Nginx） |

### 方案 B：手动部署

```bash
cd server && npm ci && npm run build && npm run start   # 后端
cd client && npm ci && npm run build                     # 前端 dist/ 交由 Nginx / CDN
```

详细部署步骤请参阅 [docs/部署运维手册.md](./docs/部署运维手册.md)。

---

## 主要 API

后端提供 RESTful API，基础路径 `/api`，统一响应格式：

```jsonc
// 成功
{ "code": 200, "message": "操作成功", "data": {} }

// 分页
{ "code": 200, "message": "查询成功", "data": { "list": [], "total": 100, "page": 1, "pageSize": 20 } }

// 错误
{ "code": 400, "message": "参数错误", "errors": [{ "field": "phone", "message": "手机号格式不正确" }] }
```

启动后访问 Swagger：`http://localhost:3000/api-docs`

主要业务域：认证 · 技能交换 · 共享厨房 · 时间银行 · 应急邻里 · 管理后台 · 积分/信誉/消息/通知/文件上传。

---

## 文档

- [项目规格说明](./docs/project-spec.md) — 背景、架构、技术栈、API 规范
- [开发规划](./docs/development-plan.md) — 三阶段迭代规划
- [Code Wiki](./docs/CODE_WIKI.md) — 模块职责、目录结构、业务流程、依赖关系
- [用户手册](./docs/用户手册.md) — 面向最终用户的操作指南
- [部署运维手册](./docs/部署运维手册.md) — 部署、备份、监控
- [设计规范](./docs/设计规范.md) — 视觉与交互规范
- [模块设计文档](./docs/modules/) — 各业务模块详细设计
- [自动迭代规范](./docs/auto-iteration-spec.md) — TRAE AI 自动迭代规范
- [比赛说明文档](./docs/比赛说明文档.md) — TRAE AI 创造力大赛参赛资料

---

## 🤖 定时任务 Agent 提示词

```text
你是邻里圈（linli-circle）项目专属自驱迭代 Agent。严格按照项目规范执行，本指令优先级高于规范默认值，规范优先级高于开发规划：e:\work\auto-community\docs\auto-iteration-spec.md

一、核心覆盖规则（规范默认值全部以此为准）
- 项目根路径：e:\work\auto-community（Monorepo 架构，所有操作仅限该目录）
- 进度记忆路径：e:\work\auto-community\memory\，读取最近日期目录的 topics.md，写入当天日期目录
- 单次调度总时长上限：4 小时；
- 当前基线进度：Phase 1 完成 8/10，仅剩 2 项 P0 收尾任务：应急资源地图页、CD 流水线；所有已完成功能不得重复开发
- 全局优先级强制排序：Phase1 收尾 > 项目健康故障修复 > Phase2 核心功能 > 技术债清理 > 样式精修 > 测试补全
- 阶段锁定规则：Phase 1 未全部验收通过前，禁止启动任何 Phase 2 完整功能开发

二、核心执行要点
1. 技术栈：前端 React+Vite+TS，后端 Express+TS，数据层 PostgreSQL+Redis
2. 六步闭环：健康度预检 → 动态规划 → 小步编码 → 全量验收 → 计划复盘 → 进度沉淀
3. 强制健康校验（前置必做，不通过绝不开发新功能）：
   - 后端：cd server && npx tsc --noEmit && npx vitest run
   - 前端：cd client && npm run build
4. 回滚机制：改动前记录原文件核心内容，类型/测试/构建失败且 3 次无法修复，立即回滚并切换备选任务
5. Git 提交规范（强制执行）：每次完成一个最小修改单元并通过验收后，必须立即执行 git add（仅添加本次修改的文件，禁止 git add -A）→ git commit → git push origin HEAD 提交代码。提交信息使用中文，格式：feat/fix/refactor/docs: 简要描述修改内容。禁止：修改 git config、force push、push --force-with-lease、reset --hard、branch -D、clean -f 等破坏性命令。
6. 语言规范：所有代码注释、交互文案、进度记录统一中文，注释说明设计原因而非仅描述内容
7. 图片资源：仅白名单接口生成装饰/占位图：https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image ，核心业务图标优先 SVG/CSS

三、第三方依赖降级规则（不阻塞迭代）
- 高德地图 API Key 缺失：应急资源地图改用静态点位 + 列表展示，完整保留业务逻辑，预留地图接入入口
- OSS/邮件/短信服务缺失：先完成核心业务逻辑，本地 mock 输出，预留统一适配层接口

四、本次调度执行流程
1. 通读规范全文，对齐所有规则与边界
2. 读取 docs/development-plan.md 对齐整体规划，读取历史 topics.md 承接上轮进度与遗留问题
3. 执行前后端健康校验，优先排查修复现有问题
4. 按优先级推进 Phase1 收尾：先开发应急资源地图页（含降级兼容），再搭建 CD 流水线
5. 每完成 1 个最小迭代单元，强制写入一次进度文件，避免丢失
6. 触发终止条件后，按规范模板输出精简工作摘要

默默干活，不主动通知用户。需用户介入的阻塞问题统一放在摘要「遗留问题」中。
```

---

## 🕐 质量保障定时任务

本项目除自驱迭代任务外，还配置了两个每日质量保障定时任务，**每天 00:00（北京时间）** 执行，与自动开发并行运行，形成「开发—检查—优化」闭环。

### 1. Bug 检查任务

- **任务名称**：`auto-community Bug 检查`
- **执行时间**：每天 00:00（Asia/Shanghai）
- **检查范围**：
  - 前端（client）：运行 `npm run lint` / `npm run test` / `npm run build`，审查 `src/pages`、`src/components`、`src/hooks`、`src/utils`
  - 后端（server）：运行 `npm run lint` / `npm run test` / `npm run build`，审查 `src/routes`、`src/services`、`src/middleware`
  - 分析最近一次提交变更（`git diff HEAD~1`），重点关注类型错误、异常处理缺失、安全漏洞（XSS / SQL 注入）、性能问题
- **输出位置**：`docs/bug-check/bug-check-YYYYMMDD.md`
- **原则**：只读不写，仅生成检查报告，不修改任何代码

### 2. 前端样式优化任务

- **任务名称**：`auto-community 前端样式优化`
- **执行时间**：每天 00:00（Asia/Shanghai）
- **优化范围**：
  - 审查 `client/src/pages` 下各模块页面（Home / Auth / TimeBank / SharedKitchen / SkillExchange / Admin）
  - 使用 `frontend-design` 技能审查页面设计质量
  - 改善视觉层次、间距、配色、字体，优化响应式布局与交互体验
- **验证**：修改后运行 `cd client && npm run build` 确保构建通过，不破坏现有功能
- **输出位置**：`docs/style-optimization/style-opt-YYYYMMDD.md`

> 两个任务均设置了「当天已有同名报告则跳过」的防重复规则，避免覆盖既有成果。

---

## 许可证

本项目基于 [Apache License 2.0](./LICENSE) 协议开源。

> Copyright © 2026 邻里圈 (Linli Circle) 研发团队。
> 本项目为 TRAE AI 创造力大赛参赛作品，遵循 Apache-2.0 协议自由使用、修改与分发。

---

<div align="center"><sub>用 AI 技术，让邻里更有温度。</sub></div>
