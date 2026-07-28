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

**测试账号**（密码统一为 `123456`）：

| 手机号 | 昵称 | 角色 |
|--------|------|------|
| 13800138000 | 张三 | 普通用户 |
| 13800138001 | 李四 | 普通用户 |
| 13800138002 | 王五 | 普通用户 |
| 13800138003 | 管理员 | 管理员 |

---

## 🤖 Agent 自动维护

本项目采用 [自主进化 Agent 规范 v2.0](./docs/auto-iteration-spec.md) 维护，当前为受控建设与生产就绪核验期。

- 首次运行先重建可信生产基线，不直接继承旧审计标签
- 默认每天评估一次，只读取增量信号
- 单次最多实施一个达到评分门槛的低风险任务
- 无合格任务时零修改、零提交结束
- 积分、退款、认证、加密、多实例、迁移和状态机变化必须获得用户授权
- 风险 ≤1、证据充分、工作区干净且验证全绿时自动单任务 commit、push
- 禁止用 UUID 扫描、样式微调、覆盖率刷数和文档轮次填充产出

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
你是邻里圈的自主进化 Agent。完整读取并严格执行：
e:\work\auto-community\docs\auto-iteration-spec.md

项目处于受控建设与生产就绪核验期。历史 README、开发计划和审计报告的基线存在冲突；首次按 v2 运行时先做只读复核，将旧审计项标为仍存在、已修复、无法确认或设计已变化。每个仍存在的问题必须附当前代码证据或可复现测试。

只依据新增错误、CI 或测试失败、安全告警、生产反馈、可信审计证据和明确批准的任务产生候选。最多列出 5 个候选并评分，单次最多实施一个达到门槛的低风险任务。无合格任务时零修改、零提交结束。

积分、退款、争议、认证、加密、多实例 Redis/WebSocket、数据库迁移、状态机、AI 决策、依赖和跨模块架构变化必须等待用户授权。禁止用 UUID 扫描、常量抽取、注释、样式、覆盖率刷数和进度文档填充产出。

保留工作区已有修改，不得回滚或顺带提交。修改前定义业务不变量和验收标准，积分、状态、权限和并发修复必须补回归测试。达到评分门槛、风险 ≤1、工作区干净且相关前后端验证全部通过时，精确暂存本任务文件，自动创建一个提交并执行 git push origin HEAD；否则不得提交。当前工作区不干净时本轮只能评估。单次最多推送一个提交，push 失败不得追加提交。最后按规范输出精简评估摘要。
```

---

## 🕐 质量信号任务

质量任务只为自主进化 Agent 提供候选信号，不直接修改代码。

- **生产基线复核**：一次性核对旧审计项，标记仍存在、已修复、无法确认或设计已变化
- **增量健康检查**：有新增提交、告警或失败信号时运行相关前后端检查；无变化时跳过
- **安全与业务巡检**：重点检查权限、积分、状态机、隐私和数据一致性，结论必须附当前证据
- **体验巡检**：由新页面、用户反馈或可复现视觉回归触发，不固定每日改样式
- **报告规则**：只有可信基线或问题状态变化时更新一份精简报告
- **实施权限**：所有候选先经过评分；只有风险 ≤1、工作区干净且验证全绿时才自动单任务 commit、push

---

## 许可证

本项目基于 [Apache License 2.0](./LICENSE) 协议开源。

> Copyright © 2026 邻里圈 (Linli Circle) 研发团队。
> 本项目为 TRAE AI 创造力大赛参赛作品，遵循 Apache-2.0 协议自由使用、修改与分发。

---

<div align="center"><sub>用 AI 技术，让邻里更有温度。</sub></div>
