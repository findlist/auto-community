# 邻里圈（Linli Circle）- Code Wiki

> 「邻里圈」社区互助生态平台 —— 一个平台，四种连接
> 参赛项目：TRAE AI 创造力大赛 · 社会服务/造种新体验赛道

---

## 目录

1. [项目概览](#1-项目概览)
2. [整体架构](#2-整体架构)
3. [技术栈](#3-技术栈)
4. [目录结构](#4-目录结构)
5. [后端模块（server）](#5-后端模块server)
6. [前端模块（client）](#6-前端模块client)
7. [数据库设计](#7-数据库设计)
8. [核心业务流程](#8-核心业务流程)
9. [依赖关系](#9-依赖关系)
10. [项目运行方式](#10-项目运行方式)
11. [关键设计说明](#11-关键设计说明)

---

## 1. 项目概览

### 1.1 项目定位

「邻里圈」是一个面向社区居民的互助生态平台，通过 **四大业务模块** 重建邻里连接、实现资源互助：

| 模块 | 核心功能 | 社会价值 |
|------|---------|---------|
| **技能交换** | 技能发布、积分结算、订单流转 | 让每个人的价值被看见 |
| **共享厨房** | 美食分享、订单预约、拼单协作 | 重建邻里烟火气 |
| **时间银行** | 时间存取、代际互助、亲情联动 | 跨代互助养老 |
| **应急邻里** | 紧急求助、响应协作、资源地图 | 关键时刻靠邻居 |

### 1.2 项目形态

Monorepo 结构，包含 `client`（前端）与 `server`（后端）两个 workspace，由根目录 `package.json` 通过 `concurrently` 统一编排启动。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    前端（React 18 + Vite）                   │
│   路由 / 页面组件 / Zustand 状态 / Axios API / WebSocket     │
└─────────────────────────────────────────────────────────────┘
                              ↕  HTTP /api/*  +  WS /ws
┌─────────────────────────────────────────────────────────────┐
│                    Express 应用入口（index.ts）              │
│  helmet / cors / json / 全局限流 / 路由 / 错误处理 / WS / 定时│
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│  中间件层：authenticate / validate / rateLimiter / errorHandler│
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│  路由层：auth / users / skills / kitchen / time-bank /       │
│         emergency / messages                                │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│  服务层：auth / user / credit / skill / skill-order /        │
│         kitchen / kitchen-order / group-order / time-bank /  │
│         emergency / emergency-resource / message / review    │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│  数据层：PostgreSQL（主库） + Redis（缓存）                   │
│  辅助：内存 Map（幂等缓存 / Token 黑名单）                    │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 分层职责

| 层级 | 职责 | 关键文件 |
|------|------|---------|
| **入口层** | HTTP 服务启动、中间件装配、WS 与定时任务初始化 | [server/src/index.ts](file:///c:/work/traeaicansai/server/src/index.ts) |
| **中间件层** | 鉴权、参数校验、限流、错误兜底 | [server/src/middleware/](file:///c:/work/traeaicansai/server/src/middleware) |
| **路由层** | 请求分发、入参校验、HTTP 响应封装 | [server/src/routes/](file:///c:/work/traeaicansai/server/src/routes) |
| **服务层** | 业务逻辑、事务编排、数据序列化 | [server/src/services/](file:///c:/work/traeaicansai/server/src/services) |
| **数据层** | 连接池、查询辅助、事务封装、缓存 | [server/src/config/](file:///c:/work/traeaicansai/server/src/config) |
| **工具层** | 错误类、统一响应、幂等、Token 黑名单 | [server/src/utils/](file:///c:/work/traeaicansai/server/src/utils) |

---

## 3. 技术栈

### 3.1 后端

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 运行时 | Node.js | 20+ | 服务端运行环境 |
| 语言 | TypeScript | 5.3 | 类型安全 |
| Web 框架 | Express | 4.18 | HTTP 路由与中间件 |
| 数据库 | PostgreSQL | 16 | 主数据存储 |
| 数据库驱动 | pg | 8.11 | 连接池与查询 |
| 缓存 | Redis | 7 | 高频缓存（已配置，业务侧按需启用） |
| Redis 客户端 | redis | 4.6 | 异步缓存操作 |
| 认证 | jsonwebtoken | 9.0 | JWT 签发与校验 |
| 密码 | bcryptjs | 2.4 | 密码哈希 |
| 校验 | express-validator | 7.0 | 入参校验 |
| 限流 | express-rate-limit | 7.1 | 接口限流 |
| 安全 | helmet | 7.1 | HTTP 安全头 |
| WebSocket | ws | 8.16 | 实时聊天 |
| 定时任务 | node-cron | 4.2 | 超时订单处理 |
| 唯一 ID | uuid | 9.0 | UUID 生成 |

### 3.2 前端

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | React | 18.3 | UI 组件 |
| 语言 | TypeScript | 5.6 | 类型安全 |
| 构建工具 | Vite | 6.0 | 开发与构建 |
| 路由 | react-router-dom | 6.28 | SPA 路由 |
| 状态管理 | zustand | 5.0 | 全局状态（含 persist 持久化） |
| HTTP | axios | 1.7 | API 请求 |
| 样式 | TailwindCSS | 4.0 | 原子化 CSS |
| 图标 | lucide-react | 0.468 | 图标库 |

---

## 4. 目录结构

```
traeaicansai/
├── package.json                 # 根 monorepo 配置（workspaces: client, server）
├── .env.example                 # 环境变量样例
├── client/                      # 前端工程
│   ├── package.json
│   ├── vite.config.ts           # Vite 配置（含 /api 代理到 3000）
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx             # React 入口
│       ├── App.tsx              # 路由配置
│       ├── index.css            # 全局样式（Tailwind）
│       ├── api/                 # API 调用层（按模块拆分）
│       ├── components/Layout/   # 布局组件（顶栏 + 底部导航）
│       ├── hooks/useAuth.ts     # 鉴权 Hook
│       ├── pages/               # 页面组件（按业务模块组织）
│       ├── stores/authStore.ts  # Zustand 鉴权状态
│       ├── types/index.ts       # 全局类型定义
│       └── utils/format.ts      # 格式化工具
├── server/                      # 后端工程
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # Express 应用入口
│       ├── config/              # 数据库 / Redis / 环境变量配置
│       ├── middleware/          # 鉴权 / 校验 / 限流 / 错误处理
│       ├── routes/              # 路由（按业务模块拆分）
│       ├── services/            # 服务层（业务逻辑）
│       ├── utils/               # 错误类 / 响应封装 / 幂等 / Token 黑名单
│       ├── jobs/scheduler.ts    # 定时任务（超时订单处理）
│       ├── websocket/index.ts   # WebSocket 实时聊天
│       └── types/express.d.ts   # Express 类型扩展
├── database/
│   └── migrations/              # SQL 迁移脚本（001 ~ 003）
└── docs/                        # 项目规格与模块设计文档
```

---

## 5. 后端模块（server）

### 5.1 应用入口 [server/src/index.ts](file:///c:/work/traeaicansai/server/src/index.ts)

**职责**：装配 Express 应用、启动 HTTP 服务、初始化 WebSocket 与定时任务调度器。

**关键流程**：

1. 创建 Express 应用与 HTTP Server
2. 装配全局中间件：`helmet` → `cors` → `express.json` → `express.urlencoded` → `apiLimiter`
3. 挂载 API 路由到 `/api`
4. 注册 `/health` 健康检查端点
5. 注册 404 与全局错误处理中间件
6. 监听端口，启动后依次调用 `initWebSocket(server)` 与 `initScheduler()`
7. 监听 `SIGTERM` 信号实现优雅关闭

### 5.2 配置层 [server/src/config/](file:///c:/work/traeaicansai/server/src/config)

#### 5.2.1 env.ts - 环境变量

集中读取并导出所有环境变量，提供默认值兜底。涵盖：`NODE_ENV`、`PORT`、`DB_*`、`REDIS_*`、`JWT_*`、`CORS_ORIGIN`、`RATE_LIMIT_*`。

#### 5.2.2 database.ts - PostgreSQL 连接池

| 导出 | 说明 |
|------|------|
| `pool` | pg 连接池（max=20，idle 30s，连接超时 2s） |
| `query<T>(text, params)` | 查询辅助函数，开发环境打印耗时日志 |
| `transaction<T>(callback)` | 事务封装：`BEGIN` → callback → `COMMIT`/`ROLLBACK` |
| `testConnection()` | 数据库连通性测试 |
| `closePool()` | 关闭连接池 |

#### 5.2.3 redis.ts - Redis 客户端

提供 `redisClient`、`connectRedis`、`disconnectRedis`，以及缓存辅助函数 `getCache` / `setCache` / `deleteCache` / `clearCachePattern`。

### 5.3 中间件层 [server/src/middleware/](file:///c:/work/traeaicansai/server/src/middleware)

#### 5.3.1 auth.ts - 认证与授权

| 函数 | 说明 |
|------|------|
| `authenticate` | 强制鉴权：解析 Bearer Token → 校验签名 → 查 Token 黑名单 → 查库校验用户状态（`deleted_at`/`status`） |
| `optionalAuth` | 可选鉴权：Token 存在则解析，失败不阻断 |
| `requireRole(...roles)` | 角色校验：实时查库获取 `role` 字段并校验 |
| `generateAccessToken(payload)` | 签发 Access Token（默认 7d） |
| `generateRefreshToken(payload)` | 签发 Refresh Token（默认 30d） |
| `verifyRefreshToken(token)` | 校验 Refresh Token |

> **设计说明**：`authenticate` 每次请求都会查询数据库以校验用户状态，确保被禁用或删除的用户立即失去访问权限，代价是增加一次 DB 查询。

#### 5.3.2 validator.ts - 参数校验

| 导出 | 说明 |
|------|------|
| `validate(validations)` | 执行 `express-validator` 校验链，失败抛 `AppError(422)` |
| `rules` | 常用校验规则（分页、ID） |
| `getPagination(req)` | 解析分页参数（page 默认 1，pageSize 默认 20，上限 100） |
| `getSortParams(req, allowedFields)` | 解析排序参数（白名单字段） |

#### 5.3.3 rateLimiter.ts - 接口限流

| 限流器 | 窗口 / 上限 | 适用场景 |
|--------|------------|---------|
| `apiLimiter` | 60s / 100 次 | 全局 API |
| `authLimiter` | 15min / 10 次 | 登录注册（按 IP） |
| `createPostLimiter` | 1h / 20 次 | 发布内容 |
| `orderLimiter` | 1min / 30 次 | 订单操作 |
| `smsLimiter` | 1min / 1 次 | 短信验证码（按手机号） |
| `searchLimiter` | 1min / 60 次 | 搜索 |

> 限流 key 优先使用 `req.user.id`，其次 `req.ip`。

#### 5.3.4 errorHandler.ts - 错误处理

| 导出 | 说明 |
|------|------|
| `errorHandler` | 全局错误处理中间件：区分 `AppError`、JWT 错误、数据库错误、未知错误 |
| `asyncHandler(fn)` | 异步路由包装器，自动捕获 Promise 异常并传递给错误中间件 |
| `notFoundHandler` | 404 处理 |

### 5.4 工具层 [server/src/utils/](file:///c:/work/traeaicansai/server/src/utils)

#### 5.4.1 errors.ts - 错误类体系

```
AppError (基类)
├── BadRequestError       (400)
├── UnauthorizedError     (401)
├── ForbiddenError        (403)
├── NotFoundError         (404)
├── ConflictError         (409)
├── ValidationError       (422)
├── TooManyRequestsError  (429)
└── InternalError         (500)
```

每个错误类携带 `statusCode`、`code`（如 `BAD_REQUEST`）、可选 `errors`（字段级错误）。

#### 5.4.2 response.ts - 统一响应封装

| 函数 | HTTP 状态 | 用途 |
|------|----------|------|
| `success(res, data, message)` | 200 | 通用成功 |
| `created(res, data, message)` | 201 | 创建成功 |
| `updated(res, data, message)` | 200 | 更新成功 |
| `deleted(res, message)` | 200 | 删除成功 |
| `paginated(res, list, total, page, pageSize, message)` | 200 | 分页响应（含 pagination 字段） |
| `error(res, message, code, errors)` | 自定义 | 错误响应 |
| `noContent(res)` | 204 | 无内容 |

#### 5.4.3 idempotency.ts - 幂等控制

- 基于 `Map` 的内存缓存，**5 秒** 幂等时间窗口
- 键格式：`${userId}:${resourceType}:${resourceId}`
- 每 60 秒定期清理过期条目
- 用于防止资产变更类接口（下单、响应求助）被重复提交

#### 5.4.4 tokenBlacklist.ts - JWT 黑名单

- 基于 `Map` 的内存实现，用于登出后使未过期 JWT 立即失效
- 每 10 分钟自动清理过期条目
- **注意**：多实例部署需替换为 Redis 等共享存储

### 5.5 路由层 [server/src/routes/](file:///c:/work/traeaicansai/server/src/routes)

#### 5.5.1 路由总表 [routes/index.ts](file:///c:/work/traeaicansai/server/src/routes/index.ts)

| 挂载路径 | 路由模块 | 说明 |
|---------|---------|------|
| `/api/auth` | auth.ts | 注册 / 登录 / 刷新 / 登出 |
| `/api/users` | users.ts | 个人资料 / 积分流水 / 时间流水 |
| `/api/skills` | skills.ts | 技能帖子 / 技能订单 |
| `/api/kitchen` | kitchen.ts | 美食分享 / 厨房订单 / 拼单 / 评价 |
| `/api/time-bank` | time-bank.ts | 时间服务 / 时间订单 / 账户 / 转账 / 家庭绑定 / 评价 / 争议 |
| `/api/emergency` | emergency.ts | 应急求助 / 响应 / 举报 / 应急资源 |
| `/api/messages` | messages.ts | 聊天记录 / 已读标记 / 未读数 |

#### 5.5.2 主要 API 端点

**认证 `/api/auth`**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/register` | - | 注册（手机号 + 密码 + 昵称），赠送 100 积分 |
| POST | `/login` | - | 登录，返回 token + refreshToken + user |
| POST | `/refresh-token` | - | 刷新令牌 |
| POST | `/logout` | ✓ | 登出，将 token 加入黑名单 |

**用户 `/api/users`**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/profile` | ✓ | 获取个人资料 |
| PUT | `/profile` | ✓ | 更新昵称 / 头像 |
| GET | `/:id` | ✓ | 获取指定用户公开信息 |
| GET | `/credit-history` | ✓ | 积分流水（分页） |
| GET | `/time-history` | ✓ | 时间流水（分页） |

**技能交换 `/api/skills`**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/posts` | - | 帖子列表（支持 type/category/keyword 过滤） |
| GET | `/posts/:id` | - | 帖子详情 |
| POST | `/posts` | ✓ | 发布帖子（offer 必须设置 credit_price） |
| PUT | `/posts/:id` | ✓ | 更新帖子（仅作者） |
| DELETE | `/posts/:id` | ✓ | 删除帖子（软删除，仅作者） |
| POST | `/orders` | ✓ | 下单（冻结积分） |
| GET | `/orders` | ✓ | 订单列表（按 status 过滤） |
| PUT | `/orders/:id/status` | ✓ | 订单状态流转（accepted/rejected/completed/cancelled） |

**共享厨房 `/api/kitchen`**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/posts` | ✓ | 发布美食（offer/need） |
| GET | `/posts` | - | 美食列表 |
| GET | `/posts/:id` | - | 美食详情 |
| PUT | `/posts/:id` | ✓ | 更新美食 |
| DELETE | `/posts/:id` | ✓ | 删除美食（软删除） |
| POST | `/orders` | ✓ | 预约领取（扣积分、减份数、设 30 分钟超时） |
| GET | `/orders` | ✓ | 订单列表（按 role/status 过滤） |
| PUT | `/orders/:id/confirm` | ✓ | 卖家确认订单 |
| PUT | `/orders/:id/complete` | ✓ | 买家完成订单（含评价、结算积分给卖家） |
| PUT | `/orders/:id/cancel` | ✓ | 取消订单（退积分、恢复份数） |
| POST | `/group-orders` | ✓ | 创建拼单 |
| GET | `/group-orders` | - | 拼单列表 |
| GET | `/group-orders/:id` | - | 拼单详情（含参与人） |
| POST | `/group-orders/:id/join` | ✓ | 参与拼单（扣积分） |
| GET | `/reviews` | - | 评价列表（按 userId 过滤） |

**时间银行 `/api/time-bank`**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/services` | 可选 | 服务列表 |
| GET | `/services/:id` | - | 服务详情 |
| POST | `/services` | ✓ | 发布服务（provide/request） |
| PUT | `/services/:id` | ✓ | 更新服务 |
| POST | `/orders` | ✓ | 下单 |
| GET | `/orders` | ✓ | 订单列表 |
| PUT | `/orders/:id/status` | ✓ | 订单状态流转（accept/start/cancel/complete） |
| GET | `/account` | ✓ | 时间账户（自动创建） |
| POST | `/transfer` | ✓ | 时间转账 |
| GET | `/transactions` | ✓ | 交易流水 |
| POST | `/family` | ✓ | 创建家庭绑定 |
| PUT | `/family/:id/confirm` | ✓ | 确认家庭绑定 |
| PUT | `/family/:id/reject` | ✓ | 拒绝家庭绑定 |
| GET | `/family` | ✓ | 家庭绑定列表 |
| POST | `/reviews` | ✓ | 创建评价 |
| POST | `/disputes` | ✓ | 创建争议 |
| GET | `/disputes` | ✓ | 争议列表 |

**应急邻里 `/api/emergency`**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/requests` | 可选 | 求助列表（按 type/status 过滤） |
| GET | `/requests/:id` | 可选 | 求助详情（含响应列表、评价列表） |
| POST | `/requests` | ✓ | 发布求助（自动识别紧急程度，30 分钟超时） |
| POST | `/requests/:id/respond` | ✓ | 响应求助（15 分钟超时） |
| PUT | `/responses/:id/status` | ✓ | 更新响应状态（arrived/completed） |
| POST | `/false-reports` | ✓ | 举报虚假求助 |
| GET | `/resources` | - | 应急资源列表 |
| GET | `/resources/:id` | - | 应急资源详情 |

**消息 `/api/messages`**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/?order_id=&order_type=` | ✓ | 聊天记录（分页，校验订单参与权） |
| POST | `/read` | ✓ | 标记消息已读 |
| GET | `/unread-count?order_type=` | ✓ | 未读消息数 |

### 5.6 服务层 [server/src/services/](file:///c:/work/traeaicansai/server/src/services)

#### 5.6.1 auth.service.ts - 认证服务

| 函数 | 说明 |
|------|------|
| `register(phone, password, nickname)` | 注册：校验手机号 → 查重 → bcrypt 哈希 → 事务插入用户 + 100 积分流水 → 签发 token |
| `login(phone, password)` | 登录：查用户 → bcrypt 校验密码 → 签发 token |
| `refreshToken(token)` | 刷新：校验 refreshToken → 查用户存在 → 重签 token |
| `logout(token)` | 登出：解码获取 exp → 加入 Token 黑名单 |
| `toUserResponse(row)` | DB 行 → API 响应对象（snake_case → camelCase） |

#### 5.6.2 user.service.ts - 用户服务

| 函数 | 说明 |
|------|------|
| `getProfile(userId)` | 获取个人资料 |
| `updateProfile(userId, data)` | 更新昵称 / 头像（动态拼 SQL） |
| `getUserById(userId)` | 获取他人公开信息 |
| `getCreditHistory(userId, page, pageSize)` | 积分流水（并行查 count + list） |
| `getTimeHistory(userId, page, pageSize)` | 时间流水（过滤 time_earn/time_spend） |

#### 5.6.3 credit.service.ts - 积分服务

| 函数 | 说明 |
|------|------|
| `freezeCredits(userId, amount, referenceId, referenceType)` | 冻结积分（扣余额 + 流水，保护余额 ≥ 10） |
| `unfreezeCredits(userId, amount, ...)` | 解冻积分 |
| `settleCredits(buyerId, sellerId, amount, referenceId)` | 结算：买家记 spend，卖家记 earn |
| `checkBalance(userId, amount)` | 余额校验（含保护余额） |
| `getCreditBalance(userId)` | 查询余额 |

> **保护余额机制**：`MIN_BALANCE = 10`，确保用户扣减后余额不低于 10。

#### 5.6.4 skill.service.ts - 技能帖子服务

| 函数 | 说明 |
|------|------|
| `createPost(userId, data)` | 发布帖子（offer 类型必须 credit_price > 0） |
| `getPostList(filters, page, pageSize)` | 列表查询（支持 type/category/keyword，并行查 count + list） |
| `getPostById(id)` | 详情（JOIN users） |
| `updatePost(id, userId, data)` | 更新（权限校验 + 动态 SQL） |
| `deletePost(id, userId)` | 软删除（权限校验） |
| `getUserPosts(userId, page, pageSize)` | 用户帖子列表 |

#### 5.6.5 skill-order.service.ts - 技能订单服务

订单状态机：`pending` → `accepted`/`rejected` → `completed`/`cancelled`

| 函数 | 说明 |
|------|------|
| `createOrder(buyerId, postId)` | 下单：幂等检查 → 校验帖子状态 → 校验余额 → 事务（冻结积分 + 创建订单） |
| `acceptOrder(orderId, sellerId)` | 接单：行锁 → 校验权限与状态 → 结算积分（买家 spend，卖家 earn） |
| `rejectOrder(orderId, sellerId)` | 拒单：行锁 → 校验 → 解冻积分退还买家 |
| `completeOrder(orderId, userId, rating?, review?)` | 完成：行锁 → 校验 → 更新状态 → 可选评价 + 信誉分（近 50 条平均） |
| `cancelOrder(orderId, userId)` | 取消：行锁 → 校验 → pending 退还冻结 / accepted 退还买家并扣回卖家（允许负债） |
| `getOrderList(userId, filters, page, pageSize)` | 订单列表（JOIN 帖子 + 买卖双方） |
| `getOrderById(orderId, userId)` | 订单详情（权限校验） |

#### 5.6.6 kitchen.service.ts - 美食分享服务

| 函数 | 说明 |
|------|------|
| `create(userId, data)` | 发布美食（type=offer/need，初始化 remaining_portions = portions） |
| `getList(filters, page, pageSize)` | 列表（支持 type/category/keyword） |
| `getById(id)` | 详情（JOIN users） |
| `update(id, userId, data)` | 更新（权限校验 + 动态 SQL） |
| `remove(id, userId)` | 软删除（status 改为 closed） |

#### 5.6.7 kitchen-order.service.ts - 厨房订单服务

| 函数 | 说明 |
|------|------|
| `create(userId, data)` | 预约：幂等检查 → 事务（行锁帖子 → 校验份数 → 扣积分 → 减份数 → 售罄改状态 → 创建订单含 30 分钟超时） |
| `confirm(orderId, sellerId)` | 卖家确认 |
| `complete(orderId, userId, reviewData)` | 买家完成：事务（结算积分给卖家 + 评价 + 信誉分） |
| `cancel(orderId, userId)` | 取消：事务（退积分 + 恢复份数 + 仅当 remaining>0 才从 sold_out 恢复 active） |
| `getList(userId, filters, page, pageSize)` | 列表（按 role=buyer/seller 过滤） |

#### 5.6.8 group-order.service.ts - 拼单服务

| 函数 | 说明 |
|------|------|
| `create(userId, data)` | 创建拼单（发起人自动加入，amount=0） |
| `join(groupOrderId, userId, amount)` | 参与：事务（行锁 → 校验状态/截止/人数/重复 → 扣积分 → 加参与记录 → 达上限改 full） |
| `getList(filters, page, pageSize)` | 列表 |
| `getById(id)` | 详情（含参与人列表） |

#### 5.6.9 time-bank.service.ts - 时间银行服务

时间银行核心常量：
- `DAILY_EARN_LIMIT = 480`（每日收益上限 480 分钟 = 8 小时）
- `FIRST_SERVICE_BONUS = 30`（首次完成服务奖励 30 分钟）
- `FIVE_STAR_BONUS = 10`（5 星好评奖励 10 分钟）

| 函数 | 说明 |
|------|------|
| `createService(userId, data)` | 发布服务（provide/request） |
| `getServiceList(filters, pagination)` | 服务列表 |
| `getServiceById(id)` | 服务详情 |
| `updateService(id, userId, data)` | 更新服务（权限校验） |
| `createOrder(userId, serviceId)` | 下单（幂等检查） |
| `updateOrderStatus(orderId, userId, action)` | 状态流转（accept/start/cancel） |
| `completeOrder(orderId, userId, actualDuration, rating?, review?)` | 完成：事务（行锁 → 校验 → 更新订单 → 双方账户操作 → 奖励计算 + 日限额校验 → 流水 + 评价 + 信誉分） |
| `getAccount(userId)` | 查询时间账户（不存在则自动创建） |
| `transferTime(fromUserId, toUserId, amount, remark?)` | 转账：事务（行锁 + 余额校验 + 双方账户与 users.time_balance 同步 + 流水） |
| `getTransactions(userId, pagination)` | 交易流水 |
| `createFamilyBinding(userId, parentPhone, relationship)` | 创建家庭绑定（按手机号查 parent） |
| `confirmFamilyBinding(bindingId, userId)` | 确认绑定（仅 parent 可操作） |
| `rejectFamilyBinding(bindingId, userId)` | 拒绝绑定 |
| `getFamilyBindings(userId)` | 绑定列表（含对方信息） |
| `createReview(orderId, reviewerId, rating, content?)` | 创建评价（订单需 completed，不可重复评价） |
| `createDispute(orderId, reporterId, reason, description?, evidence?)` | 创建争议 |
| `getDisputes(userId, pagination)` | 争议列表 |
| `getOrders(userId, pagination)` | 订单列表（含对方信息） |

> **核心辅助**：`getOrCreateAccount(client, userId)` 在事务内使用 `FOR UPDATE` 行锁查询或创建时间账户，防止并发场景下余额丢失更新。

#### 5.6.10 emergency.service.ts - 应急邻里服务

**紧急程度识别**（基于关键词）：

| 级别 | 关键词 |
|------|--------|
| critical | 发烧、骨折、出血、昏迷、火灾、地震、心脏 |
| high | 漏水、停电、困住、受伤、中毒 |
| medium | 帮忙、修理、搬运、买药 |
| low | 默认 |

| 函数 | 说明 |
|------|------|
| `classifyUrgency(title, description)` | 关键词匹配识别紧急程度 |
| `createRequest(userId, data)` | 发布求助（30 分钟超时） |
| `getRequests(params)` | 求助列表（按 type/status 过滤） |
| `getRequestById(id)` | 详情（含响应列表 + 评价列表，accepted 状态检查超时） |
| `respondToRequest(userId, requestId, data)` | 响应求助（幂等检查 + 重复响应校验 + 15 分钟超时） |
| `updateResponseStatus(userId, responseId, status, reviewData?)` | 状态更新：arrived（仅响应者）/ completed（仅求助者，事务结算积分：基础 100/50 + 5 星奖励 10） |
| `checkTimeout(response)` | 单条响应超时检查（accepted → timeout） |
| `createReport(userId, requestId, reason)` | 举报虚假求助（不可重复举报） |

#### 5.6.11 emergency-resource.service.ts - 应急资源服务

| 函数 | 说明 |
|------|------|
| `getResources(params)` | 资源列表（按 type 过滤，并行查 count + list） |
| `getResourceById(id)` | 资源详情 |

#### 5.6.12 message.service.ts - 消息服务

| 函数 | 说明 |
|------|------|
| `sendMessage(senderId, receiverId, orderId, content, type, orderType)` | 发送消息 |
| `getMessages(orderId, userId, page, pageSize, orderType)` | 聊天记录（先校验订单参与权） |
| `markAsRead(orderId, userId, orderType)` | 标记已读 |
| `getUnreadCount(userId, orderType?)` | 未读数（可按订单类型过滤） |
| `getOrderParticipants(orderId, orderType, userId)` | 内部：根据订单类型查询双方用户 ID 并校验访问权限 |

> **多模块适配**：`getOrderParticipants` 根据 `orderType`（skill/kitchen/time/emergency）查询不同表的双方用户字段。

#### 5.6.13 review.service.ts - 评价服务

| 函数 | 说明 |
|------|------|
| `createReview(reviewerId, reviewedId, orderId, orderType, rating, content?)` | 创建评价（不可重复） |
| `calculateReputation(userId)` | 计算信誉分（近 50 条评价平均，写入 users.reputation_score） |
| `getReviewsByUser(userId, page, pageSize)` | 用户收到的评价列表 |

### 5.7 WebSocket [server/src/websocket/index.ts](file:///c:/work/traeaicansai/server/src/websocket/index.ts)

**职责**：提供基于订单的实时聊天能力。

**关键设计**：

- 路径：`/ws?token=<JWT>`
- 连接时校验 JWT，失败关闭（4001）
- `userSockets: Map<userId, WebSocket>` 维护在线用户连接
- 同一用户重复连接时关闭旧连接（4002）
- 30 秒心跳 ping
- 消息类型 `chat`：根据 `orderType`（默认 skill）调用 `resolveReceiverId` 解析接收方 → 调用 `messageService.sendMessage` 持久化 → 给发送方回 `chat_ack` → 若接收方在线则推送 `chat`
- `resolveReceiverId` 根据 orderType 查询不同订单表确定接收方

### 5.8 定时任务 [server/src/jobs/scheduler.ts](file:///c:/work/traeaicansai/server/src/jobs/scheduler.ts)

**调度**：`cron.schedule('*/5 * * * *', ...)` 每 5 分钟执行一次。

| 任务 | 超时规则 | 处理动作 |
|------|---------|---------|
| `handleSkillOrderTimeout` | pending > 7 天 / accepted > 7 天 | pending 自动取消退款；accepted 自动完成 |
| `handleKitchenOrderTimeout` | pending > 30 分钟 | 自动取消、退款、恢复份数 |
| `handleTimeOrderTimeout` | pending > 48 小时 | 自动取消 |
| `handleEmergencyTimeout` | accepted 且 timeout_at < NOW() | 状态置为 timeout |

> 每个任务独立 `try/catch`，单个任务失败不影响其他任务。

---

## 6. 前端模块（client）

### 6.1 应用入口

- [client/src/main.tsx](file:///c:/work/traeaicansai/client/src/main.tsx)：ReactDOM 渲染入口，使用 StrictMode
- [client/src/App.tsx](file:///c:/work/traeaicansai/client/src/App.tsx)：BrowserRouter + Routes，所有路由嵌套在 `<Layout />` 下

### 6.2 路由结构

| 路径 | 页面组件 | 说明 |
|------|---------|------|
| `/` | Home | 首页 |
| `/login` | Login | 登录 |
| `/register` | Register | 注册 |
| `/skills` | SkillExchange | 技能列表 |
| `/skills/create` | SkillExchangeCreate | 发布技能 |
| `/skills/orders` | SkillExchangeOrders | 我的技能订单 |
| `/skills/:id` | SkillExchangeDetail | 技能详情 |
| `/chat/:orderId` | Chat | 订单聊天 |
| `/kitchen` | SharedKitchen | 美食列表 |
| `/kitchen/create` | SharedKitchenCreate | 发布美食 |
| `/kitchen/:id` | SharedKitchenDetail | 美食详情 |
| `/kitchen/orders` | SharedKitchenOrders | 我的厨房订单 |
| `/kitchen/group-orders` | SharedKitchenGroupOrders | 拼单列表 |
| `/time-bank` | TimeBank | 时间服务列表 |
| `/time-bank/create` | TimeBankCreateService | 发布时间服务 |
| `/time-bank/account` | TimeBankAccount | 时间账户 |
| `/time-bank/family` | TimeBankFamilyBinding | 家庭绑定 |
| `/time-bank/orders` | TimeBankMyOrders | 我的时间订单 |
| `/time-bank/:id` | TimeBankServiceDetail | 服务详情 |
| `/emergency` | Emergency | 应急列表 |
| `/emergency/:id` | Emergency | 应急详情 |
| `/profile` | Profile | 个人资料 |

### 6.3 布局组件 [components/Layout/index.tsx](file:///c:/work/traeaicansai/client/src/components/Layout/index.tsx)

- 顶部 header：Logo + 登录/头像入口
- 中部 main：`<Outlet />` 渲染子路由
- 底部 nav：5 个主导航（首页 / 技能 / 厨房 / 时间银行 / 应急）

### 6.4 API 调用层 [client/src/api/](file:///c:/work/traeaicansai/client/src/api)

#### 6.4.1 client.ts - Axios 实例

- `baseURL: /api`，超时 10s
- 请求拦截：自动注入 `Authorization: Bearer <token>`
- 响应拦截：
  - 成功直接返回 `response.data`
  - 401：清除 token + auth-storage，跳转 `/login`
  - 其他：提取字段级错误，封装为 `ApiError`

#### 6.4.2 模块 API 文件

| 文件 | 说明 |
|------|------|
| [auth.ts](file:///c:/work/traeaicansai/client/src/api/auth.ts) | login / register / refreshToken / logout |
| [skills.ts](file:///c:/work/traeaicansai/client/src/api/skills.ts) | 技能帖子 CRUD + 订单操作 |
| [kitchen.ts](file:///c:/work/traeaicansai/client/src/api/kitchen.ts) | 美食分享 / 订单 / 拼单 / 评价 |
| [timeBank.ts](file:///c:/work/traeaicansai/client/src/api/timeBank.ts) | 时间服务 / 订单 / 账户 / 转账 / 家庭绑定 / 评价 / 争议 |
| [emergency.ts](file:///c:/work/traeaicansai/client/src/api/emergency.ts) | 应急求助 / 响应 / 举报 / 资源 |
| [messages.ts](file:///c:/work/traeaicansai/client/src/api/messages.ts) | 聊天记录 / 已读 / 未读数 |

### 6.5 状态管理 [stores/authStore.ts](file:///c:/work/traeaicansai/client/src/stores/authStore.ts)

使用 Zustand + `persist` 中间件，持久化到 localStorage（key: `auth-storage`）。

```typescript
interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  setUser: (user: User) => void;
}
```

### 6.6 Hook [hooks/useAuth.ts](file:///c:/work/traeaicansai/client/src/hooks/useAuth.ts)

对 `authStore` 的薄封装，便于组件消费。

### 6.7 类型定义 [types/index.ts](file:///c:/work/traeaicansai/client/src/types/index.ts)

定义全部业务类型，包括：
- `User`、`SkillPost`、`SkillOrder`
- `KitchenPost`、`KitchenOrder`、`GroupOrder`、`GroupOrderParticipant`、`FoodReview`
- `TimeService`、`TimeOrder`、`TimeAccount`、`TimeTransaction`、`FamilyBinding`、`ServiceDispute`
- `EmergencyRequest`、`EmergencyResponse`、`EmergencyReview`、`EmergencyResource`
- `Message`、`Review`、`CreditTransaction`
- `ApiResponse<T>`、`PaginatedResponse<T>`、`PaginationInfo`

### 6.8 工具函数 [utils/format.ts](file:///c:/work/traeaicansai/client/src/utils/format.ts)

| 函数 | 说明 |
|------|------|
| `formatDate(dateStr)` | 相对时间格式化（刚刚 / N 分钟前 / N 小时前 / N 天前 / MM-DD / YYYY-MM-DD） |
| `formatPhone(phone)` | 手机号脱敏（138****1234） |
| `formatCredits(credits)` | 积分格式化（≥10000 显示 X.X 万） |
| `formatTime(minutes)` | 分钟转可读时长（N 分钟 / N 小时 / N 小时 M 分钟） |

### 6.9 Vite 配置 [vite.config.ts](file:///c:/work/traeaicansai/client/vite.config.ts)

- 插件：`@vitejs/plugin-react` + `@tailwindcss/vite`
- 路径别名：`@` → `/src`
- 开发代理：`/api` → `http://localhost:3000`

---

## 7. 数据库设计

### 7.1 迁移脚本

| 文件 | 说明 |
|------|------|
| [001_init.sql](file:///c:/work/traeaicansai/database/migrations/001_init.sql) | 初始化所有核心表与索引 |
| [002_emergency.sql](file:///c:/work/traeaicansai/database/migrations/002_emergency.sql) | 应急模块补充：type/eta/timeout_at 字段 + emergency_resources 表 |
| [002_shared_kitchen.sql](file:///c:/work/traeaicansai/database/migrations/002_shared_kitchen.sql) | 厨房模块补充：category/health_cert 字段 + group_orders/group_order_participants 表 |
| [002_time_bank.sql](file:///c:/work/traeaicansai/database/migrations/002_time_bank.sql) | 时间银行补充：time_accounts/time_transactions/family_bindings 表 |
| [003_fix_audit_issues.sql](file:///c:/work/traeaicansai/database/migrations/003_fix_audit_issues.sql) | 审计修复：messages.order_type、users.role 字段 + 多个复合索引 |

### 7.2 核心数据表

#### 用户模块

| 表 | 主键 | 说明 |
|----|------|------|
| `users` | id (UUID) | 用户主表：phone/password_hash/nickname/credit_balance/time_balance/reputation_score/status/role |
| `communities` | id | 社区表 |

#### 技能交换模块

| 表 | 说明 |
|----|------|
| `skill_posts` | 技能帖子（type=offer/request，credit_price，images/tags 数组，location POINT） |
| `skill_orders` | 技能订单（buyer_id/seller_id/credit_amount/status） |

#### 共享厨房模块

| 表 | 说明 |
|----|------|
| `kitchen_posts` | 美食帖子（type=offer/need，portions/remaining_portions，allergens，health_cert） |
| `kitchen_orders` | 厨房订单（user_id 买家/seller_id 卖家，portions，credit_amount，timeout_at） |
| `group_orders` | 拼单（initiator_id，target_amount，min/max_participants，deadline） |
| `group_order_participants` | 拼单参与人（UNIQUE(group_order_id, user_id)） |

#### 时间银行模块

| 表 | 说明 |
|----|------|
| `time_services` | 时间服务（type=provide/request，duration_minutes，certification JSONB） |
| `time_orders` | 时间订单（provider_id/requester_id，duration_minutes） |
| `time_accounts` | 时间账户（user_id UNIQUE，balance/total_earned/total_spent） |
| `time_transactions` | 时间交易（from_user_id 可空，type=earn/spend/transfer/donate/bonus） |
| `family_bindings` | 家庭绑定（user_id/parent_id/relationship/status） |
| `service_disputes` | 服务争议 |

#### 应急邻里模块

| 表 | 说明 |
|----|------|
| `emergency_requests` | 求助请求（type=emergency/daily，urgency，is_anonymous，timeout_at） |
| `emergency_responses` | 响应记录（responder_id，eta，timeout_at，arrived_at/completed_at） |
| `false_reports` | 虚假举报 |
| `emergency_resources` | 应急资源（community_id，type，location POINT） |

#### 公共模块

| 表 | 说明 |
|----|------|
| `credit_transactions` | 积分流水（type，amount，balance_after，reference_id/reference_type） |
| `reviews` | 评价（order_id/order_type，rating 1-5） |
| `messages` | 消息（sender_id/receiver_id，order_id/order_type，read_at） |

### 7.3 设计规范

- 所有表使用 UUID 主键（`uuid_generate_v4()`）
- 统一包含 `created_at` / `updated_at`，软删除表含 `deleted_at`
- 地理位置使用 `POINT` 类型
- 时间字段使用 `TIMESTAMP`
- 关键查询字段建立单列与复合索引（见 003 迁移）

---

## 8. 核心业务流程

### 8.1 用户注册与积分初始化

```
POST /api/auth/register
  → 校验手机号格式 + 查重
  → bcrypt 哈希密码
  → 事务：
      INSERT users (credit_balance = 100)
      INSERT credit_transactions (type=earn, amount=100, '新用户注册奖励')
  → 签发 access token + refresh token
  → 返回 { token, refreshToken, user }
```

### 8.2 技能交换订单全流程

```
1. 买家 POST /api/skills/orders { post_id }
   → 幂等检查（5s）
   → 校验帖子 active + 非自己 + 余额足够
   → 事务：冻结积分（扣余额 + freeze 流水）+ 创建订单（pending）

2. 卖家 PUT /api/skills/orders/:id/status { status: 'accepted' }
   → 行锁 + 权限校验
   → 结算积分：买家 spend 流水，卖家 earn 入账

3. 买家/卖家 PUT /api/skills/orders/:id/status { status: 'completed', rating, review }
   → 行锁 + 权限校验
   → 更新订单 completed
   → 可选：插入 reviews + 重算信誉分（近 50 条平均）

异常分支：
- 卖家 reject → 解冻退还买家
- 任意方 cancel → pending 退还冻结 / accepted 退还买家并扣回卖家（允许负债）
- 定时任务：pending > 7 天自动取消；accepted > 7 天自动完成
```

### 8.3 共享厨房订单流程

```
1. 买家 POST /api/kitchen/orders { postId, quantity }
   → 幂等检查
   → 事务：行锁帖子 → 校验份数 → 扣积分（spend）→ 减份数 → 售罄改 sold_out
          → 创建订单（pending，timeout_at = NOW + 30min）

2. 卖家 PUT /api/kitchen/orders/:id/confirm → confirmed
3. 买家 PUT /api/kitchen/orders/:id/complete { rating, content }
   → 事务：结算积分给卖家（earn）+ 评价 + 信誉分
4. 取消：退积分 + 恢复份数（仅当 remaining>0 才从 sold_out 恢复 active）

超时：pending > 30 分钟由定时任务自动取消
```

### 8.4 时间银行完成订单流程

```
PUT /api/time-bank/orders/:id/status { action: 'complete', actual_duration, rating, review }
  → 事务：
      行锁订单 + 校验（仅 requester 可完成，状态需 in_progress）
      更新订单 completed + duration_minutes
      getOrCreateAccount（行锁）双方账户
      余额校验：requester.balance ≥ actualDuration
      奖励计算：
        - 首次完成服务 +30 分钟
        - 5 星好评 +10 分钟
      日限额校验：provider 当日 earn + 本次收益 ≤ 480 分钟
      账户更新：provider 加余额 + total_earned；requester 减余额 + total_spent
      users.time_balance 同步更新
      插入 time_transactions（earn/spend/bonus）
      可选：插入 reviews + 重算信誉分
```

### 8.5 应急邻里流程

```
1. 求助者 POST /api/emergency/requests
   → 关键词识别 urgency（critical/high/medium/low）
   → 创建请求（status=open，timeout_at = NOW + 30min）

2. 响应者 POST /api/emergency/requests/:id/respond { message, eta }
   → 幂等检查 + 重复响应校验
   → 创建响应（status=accepted，timeout_at = NOW + 15min）
   → 更新请求 status=responding

3. 响应者 PUT /api/emergency/responses/:id/status { status: 'arrived' }
   → 仅响应者可操作

4. 求助者 PUT /api/emergency/responses/:id/status { status: 'completed', rating, review }
   → 事务：更新响应 completed + 请求 resolved
          + 评价 + 积分奖励（基础 100/50 + 5 星 +10）

超时：定时任务将 accepted 且 timeout_at < NOW 的响应置为 timeout
```

### 8.6 实时聊天流程

```
客户端 → WS /ws?token=<JWT>
  → 服务端校验 JWT
  → userSockets[userId] = ws（旧连接关闭）
  → 30s 心跳 ping

客户端发送 { type: 'chat', orderType, orderId, content }
  → resolveReceiverId(orderId, orderType, senderId) 查询接收方
  → messageService.sendMessage 持久化
  → 回发送方 { type: 'chat_ack', data: message }
  → 接收方在线则推送 { type: 'chat', data: message }
```

---

## 9. 依赖关系

### 9.1 后端模块依赖图

```
index.ts
  ├── config/env
  ├── config/database ←── 大部分 service / middleware
  ├── config/redis
  ├── middleware/errorHandler ←── 所有 routes
  ├── middleware/rateLimiter ←── 所有 routes
  ├── middleware/auth ←── auth.service / 大部分 routes
  ├── middleware/validator ←── 大部分 routes
  ├── routes/* ←── services/*
  ├── websocket ←── services/message.service / config/database / config/env
  ├── jobs/scheduler ←── services/skill-order / kitchen-order / config/database
  └── utils/errors ←── 所有 service / middleware

services 间依赖：
  auth.service ←── user.service（toUserResponse 复用）
  skill-order.service ←── utils/idempotency
  kitchen-order.service ←── utils/idempotency
  time-bank.service ←── utils/idempotency
  emergency.service ←── utils/idempotency
```

### 9.2 前端模块依赖图

```
main.tsx → App.tsx → Layout + pages/*
pages/* → api/* + hooks/useAuth + types
api/* → api/client（axios 实例）+ types
hooks/useAuth → stores/authStore
stores/authStore → types
```

### 9.3 前后端契约

- API 基础路径：`/api/*`
- 统一响应格式：`{ code, message, data }` / 分页 `{ code, message, data: { list, pagination } }`
- 鉴权：`Authorization: Bearer <token>`
- WebSocket：`/ws?token=<JWT>`
- 字段命名：后端 DB snake_case ↔ API 响应 camelCase（由各 service 的 `to*Response` 函数转换）

---

## 10. 项目运行方式

### 10.1 环境准备

**必需服务**：

- Node.js ≥ 20
- PostgreSQL ≥ 16
- Redis ≥ 7（已配置，业务侧按需启用）

**环境变量**：复制 [.env.example](file:///c:/work/traeaicansai/.env.example) 为 `.env`，按需修改：

```env
NODE_ENV=development
PORT=3000

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=linli_circle
DB_USER=postgres
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=your_jwt_secret_key_change_in_production
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# CORS
CORS_ORIGIN=http://localhost:5173

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
```

### 10.2 数据库初始化

```bash
# 1. 创建数据库
createdb linli_circle

# 2. 执行迁移脚本（按顺序）
psql -h localhost -p 5432 -U postgres -d linli_circle -f database/migrations/001_init.sql
psql -h localhost -p 5432 -U postgres -d linli_circle -f database/migrations/002_emergency.sql
psql -h localhost -p 5432 -U postgres -d linli_circle -f database/migrations/002_shared_kitchen.sql
psql -h localhost -p 5432 -U postgres -d linli_circle -f database/migrations/002_time_bank.sql
psql -h localhost -p 5432 -U postgres -d linli_circle -f database/migrations/003_fix_audit_issues.sql

# 或使用 npm 脚本（仅执行 001）
npm run db:migrate
```

### 10.3 安装依赖

```bash
# 在根目录执行（monorepo workspaces 会同时安装 client 与 server 依赖）
npm install
```

### 10.4 开发模式

```bash
# 同时启动前后端开发服务
npm run dev

# 或分别启动
npm run dev:server   # 后端：tsx watch，端口 3000
npm run dev:client   # 前端：vite，端口 5173，代理 /api → 3000
```

- 后端：`http://localhost:3000`（API：`http://localhost:3000/api`，健康检查：`http://localhost:3000/health`）
- 前端：`http://localhost:5173`
- WebSocket：`ws://localhost:3000/ws?token=<JWT>`

### 10.5 生产构建

```bash
# 同时构建前后端
npm run build

# 或分别构建
npm run build:client   # tsc -b && vite build → client/dist
npm run build:server   # tsc → server/dist

# 启动生产服务
cd server && npm start   # node dist/index.js
```

### 10.6 npm 脚本一览

**根目录**：

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 并发启动前后端开发服务 |
| `npm run dev:client` | 启动前端开发服务 |
| `npm run dev:server` | 启动后端开发服务 |
| `npm run build` | 构建前后端 |
| `npm run build:client` | 构建前端 |
| `npm run build:server` | 构建后端 |
| `npm run db:migrate` | 执行 001_init.sql 迁移 |

**server**：

| 脚本 | 说明 |
|------|------|
| `npm run dev` | `tsx watch src/index.ts` |
| `npm run build` | `tsc` |
| `npm start` | `node dist/index.js` |
| `npm run db:migrate` | 执行初始迁移 |

**client**：

| 脚本 | 说明 |
|------|------|
| `npm run dev` | `vite` |
| `npm run build` | `tsc -b && vite build` |
| `npm run preview` | `vite preview` |

---

## 11. 关键设计说明

### 11.1 统一响应规范

所有 API 统一返回：

```json
{ "code": 200, "message": "success", "data": {} }
```

分页响应：

```json
{
  "code": 200,
  "message": "查询成功",
  "data": {
    "list": [],
    "pagination": { "page": 1, "pageSize": 20, "total": 100, "totalPages": 5, "hasNext": true, "hasPrev": false }
  }
}
```

错误响应：

```json
{
  "code": "VALIDATION_ERROR",
  "message": "参数验证失败",
  "errors": [{ "field": "phone", "message": "手机号格式不正确" }]
}
```

### 11.2 错误码规范

| HTTP 状态 | code | 说明 |
|----------|------|------|
| 200 | - | 成功 |
| 201 | - | 创建成功 |
| 400 | BAD_REQUEST | 请求参数错误 |
| 401 | UNAUTHORIZED | 未授权 |
| 403 | FORBIDDEN | 禁止访问 |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | CONFLICT | 数据冲突 |
| 422 | VALIDATION_ERROR | 参数验证失败 |
| 429 | TOO_MANY_REQUESTS | 请求过多 |
| 500 | INTERNAL_SERVER_ERROR | 服务器内部错误 |

### 11.3 事务与并发控制

- **资产变更类操作**（下单、结算、转账、完成订单）一律使用 `transaction()` 包裹
- **关键更新使用行锁** `SELECT ... FOR UPDATE`，避免并发场景下余额丢失更新
- **幂等控制**：下单、响应求助等接口通过 `idempotency` 工具在 5 秒窗口内防重复提交

### 11.4 安全设计

- 密码使用 bcrypt（salt rounds = 10）哈希存储
- JWT 鉴权，登出通过内存黑名单使 token 立即失效
- `authenticate` 中间件每次请求查库校验用户状态（被禁用/删除立即失效）
- helmet 设置安全 HTTP 头
- 多级限流（全局 / 认证 / 发布 / 订单 / 短信 / 搜索）
- 输入校验（express-validator）+ 服务层防御性校验（如手机号格式）
- 软删除机制（`deleted_at`）保留数据可追溯

### 11.5 信誉分计算

- 评价提交后，取被评价人**最近 50 条评价**的平均分作为信誉分
- 写入 `users.reputation_score`（DECIMAL(3,2)，默认 5.00）

### 11.6 时间银行激励机制

| 激励 | 数值 | 触发条件 |
|------|------|---------|
| 首次服务奖励 | +30 分钟 | provider 首次完成服务 |
| 5 星好评奖励 | +10 分钟 | 完成订单时 rating = 5 |
| 每日收益上限 | 480 分钟 | provider 当日 earn + bonus 总和 |

### 11.7 应急紧急程度识别

基于关键词的规则匹配（非 AI 模型），按 critical → high → medium → low 优先级返回首个命中级别。

### 11.8 已知限制

- **Token 黑名单**与**幂等缓存**基于内存 Map 实现，多实例部署需替换为 Redis
- **WebSocket** 单实例方案，多实例需引入共享状态（如 Redis Pub/Sub）
- `db:migrate` 脚本仅执行 001_init.sql，002/003 迁移需手动执行
- 部分模块（如 AI 智能匹配、地图服务、OSS 存储）在规格中规划但未在代码中实现

---

## 附录：关键文件速查

| 关注点 | 文件 |
|--------|------|
| 后端入口 | [server/src/index.ts](file:///c:/work/traeaicansai/server/src/index.ts) |
| 数据库配置 | [server/src/config/database.ts](file:///c:/work/traeaicansai/server/src/config/database.ts) |
| 鉴权中间件 | [server/src/middleware/auth.ts](file:///c:/work/traeaicansai/server/src/middleware/auth.ts) |
| 错误类 | [server/src/utils/errors.ts](file:///c:/work/traeaicansai/server/src/utils/errors.ts) |
| 响应封装 | [server/src/utils/response.ts](file:///c:/work/traeaicansai/server/src/utils/response.ts) |
| 幂等控制 | [server/src/utils/idempotency.ts](file:///c:/work/traeaicansai/server/src/utils/idempotency.ts) |
| 路由总表 | [server/src/routes/index.ts](file:///c:/work/traeaicansai/server/src/routes/index.ts) |
| WebSocket | [server/src/websocket/index.ts](file:///c:/work/traeaicansai/server/src/websocket/index.ts) |
| 定时任务 | [server/src/jobs/scheduler.ts](file:///c:/work/traeaicansai/server/src/jobs/scheduler.ts) |
| 前端入口 | [client/src/main.tsx](file:///c:/work/traeaicansai/client/src/main.tsx) |
| 前端路由 | [client/src/App.tsx](file:///c:/work/traeaicansai/client/src/App.tsx) |
| Axios 实例 | [client/src/api/client.ts](file:///c:/work/traeaicansai/client/src/api/client.ts) |
| 鉴权状态 | [client/src/stores/authStore.ts](file:///c:/work/traeaicansai/client/src/stores/authStore.ts) |
| 类型定义 | [client/src/types/index.ts](file:///c:/work/traeaicansai/client/src/types/index.ts) |
| 初始迁移 | [database/migrations/001_init.sql](file:///c:/work/traeaicansai/database/migrations/001_init.sql) |
| 项目规格 | [docs/project-spec.md](file:///c:/work/traeaicansai/docs/project-spec.md) |
