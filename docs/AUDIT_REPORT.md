# 邻里圈项目生产落地全面审查报告

> **审查日期**：2026-06-17
> **审查范围**：c:\work\traeaicansai 全仓（server / client / database / docs / 配置）
> **审查方式**：只读分析，未修改任何业务代码
> **审查依据**：`docs/CODE_WIKI.md`、`docs/project-spec.md`、`docs/modules/*.md`

---

## 一、执行摘要

### 1.1 整体评估

**生产就绪度评分：3 / 10**（不具备生产落地条件）

项目四大业务模块（技能交换、共享厨房、时间银行、应急邻里）的主流程代码已基本完成，事务、行锁、幂等等关键机制在多数场景下到位。但存在大量阻塞性问题，集中在三个层面：

1. **多实例扩展性失效**：Token 黑名单、幂等缓存、WebSocket 三处基于内存 Map 实现，多实例部署完全失效
2. **资金/积分安全漏洞**：技能订单双花漏洞、应急完成可重复发积分、拼单无退款机制、`credit.service.ts` 死代码导致积分逻辑分散
3. **生产运维能力缺失**：无容器化、无迁移版本化、无测试、无 CI/CD、无审计日志、敏感数据明文存储

此外，项目作为"TRAE AI 创造力大赛"参赛作品，规格中作为核心卖点的 **AI 能力（智能匹配、需求分类、安全风控）几乎完全未实现**。

### 1.2 问题统计

| 级别 | 数量 | 说明 |
|------|------|------|
| **P0 阻塞性** | 18 | 必须修复才能上线，涉及资金安全、数据合规、核心流程断裂、多实例失效 |
| **P1 重要** | 30+ | 强烈建议修复，涉及流程缺口、并发安全、合规风险、运维能力 |
| **P2 优化** | 40+ | 可择机优化，涉及性能、代码质量、安全加固、可维护性 |

### 1.3 优先修复路径

```
第一批（资金安全 + 数据合规）：
  → 技能订单双花漏洞
  → 应急完成重复发积分
  → 拼单退款机制
  → 手机号加密存储 + API 脱敏
  → time-bank SQL 注入
  → 审计日志

第二批（多实例 + 核心流程）：
  → Token 黑名单 / 幂等 / WebSocket Redis 化
  → disputed 争议处理流程
  → expires_at 过期处理
  → 应急求助超时处理
  → 时间银行日收益上限检查时机

第三批（生产运维）：
  → 容器化 + 迁移版本化
  → 测试 + CI/CD
  → 日志规范 + 监控告警
  → AI 能力补齐
```

---

## 二、阻塞性问题（P0）

### P0-1：技能订单 createOrder 双花漏洞（积分凭空增减）

- **问题描述**：`skill-order.service.ts:39-69` 余额检查在事务外（line 39-46），事务内扣减时无行锁、无重新校验。两个并发请求可同时通过余额检查，都执行扣减，导致买家余额为负，凭空多消费积分。
- **复现场景**：买家余额 100，帖子价 80（满足 100-80=20≥10）。两个并发下单请求都通过校验，分别扣减 80，余额变 -60。买家用 100 积分下了两个 80 积分订单，系统凭空多出 60 积分。
- **影响范围**：积分系统可被恶意刷取，资金损失无上限
- **涉及文件**：[server/src/services/skill-order.service.ts](file:///c:/work/traeaicansai/server/src/services/skill-order.service.ts#L24-L74)
- **修复建议**：将余额检查移入事务并对买家行加 `FOR UPDATE` 锁：

```typescript
async function createOrder(buyerId: string, postId: string) {
  const cached = idempotency.checkIdempotency(buyerId, 'skill_order', postId);
  if (cached !== null) return cached;

  // 帖子查询可在事务外
  const postResult = await query(
    'SELECT * FROM skill_posts WHERE id = $1 AND deleted_at IS NULL', [postId],
  );
  if (postResult.rows.length === 0) throw new NotFoundError('技能帖子');
  const post = postResult.rows[0];
  if (post.status !== 'active') throw new BadRequestError('该帖子不可交易');
  if (post.user_id === buyerId) throw new BadRequestError('不能购买自己的帖子');

  const result = await transaction(async (client) => {
    // 事务内加行锁查询余额，消除 TOCTOU
    const balanceResult = await client.query(
      'SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE', [buyerId],
    );
    const balance = balanceResult.rows[0].credit_balance;
    if (balance < post.credit_price || balance - post.credit_price < MIN_BALANCE) {
      throw new BadRequestError('积分余额不足');
    }
    await client.query(
      'UPDATE users SET credit_balance = credit_balance - $1 WHERE id = $2',
      [post.credit_price, buyerId],
    );
    await client.query(
      `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
       SELECT $1, 'freeze', $2, credit_balance, $3, 'skill_order', '技能订单冻结'
       FROM users WHERE id = $1`,
      [buyerId, -post.credit_price, postId],
    );
    const orderResult = await client.query(
      `INSERT INTO skill_orders (post_id, buyer_id, seller_id, credit_amount, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [postId, buyerId, post.user_id, post.credit_price],
    );
    return toSkillOrder(orderResult.rows[0]);
  });

  idempotency.setIdempotencyResult(buyerId, 'skill_order', postId, result);
  return result;
}
```

### P0-2：应急完成订单可重复触发，重复发放积分

- **问题描述**：`emergency.service.ts:291-373` 完成订单时：(1) 未使用 `FOR UPDATE` 锁定 `emergency_responses` 记录；(2) 未校验 `response.status` 是否为 `arrived`/`accepted`，可从 `timeout`/`completed` 直接跳到 `completed`；(3) 未校验 `request.status` 是否为 `responding`。求助者可重复调用完成接口，每次都发放 100+ 积分。
- **影响范围**：积分凭空增发；应急模块积分系统可被刷爆
- **涉及文件**：[server/src/services/emergency.service.ts](file:///c:/work/traeaicansai/server/src/services/emergency.service.ts#L291-L373)
- **修复建议**：

```typescript
const responseResult = await query(
  'SELECT * FROM emergency_responses WHERE id = $1 FOR UPDATE', [responseId],
);
// ... 现有校验 ...
if (!['accepted', 'arrived'].includes(response.status)) {
  throw new BadRequestError('响应状态不允许完成');
}
if (request.status !== 'responding') {
  throw new BadRequestError('求助状态不允许完成');
}
```

### P0-3：拼单模块缺少取消/退款/完成/结算全流程

- **问题描述**：`group-order.service.ts` 只实现了 `create`、`join`、`getList`、`getById`，完全没有 `cancel`、`refund`、`complete`、`settle` 函数。`join` 时直接扣减参与者积分（line 119-128），但拼单失败（截止时间过期未达最小人数）或成功后都没有后续处理。`scheduler.ts` 也没有处理拼单超时。
- **影响范围**：所有拼单；参与者积分被永久锁定/损失，拼单成功后卖家也收不到积分
- **涉及文件**：[server/src/services/group-order.service.ts](file:///c:/work/traeaicansai/server/src/services/group-order.service.ts#L74-L161)、[server/src/jobs/scheduler.ts](file:///c:/work/traeaicansai/server/src/jobs/scheduler.ts)
- **修复建议**：新增 `cancel`（退款+恢复状态）、`complete`（结算给发起人/卖家）接口；在 scheduler 中增加拼单截止超时处理，自动取消未达最小人数的拼单并退款。示例骨架：

```typescript
async function cancel(groupOrderId: string, userId: string, reason?: string) {
  return transaction(async (client) => {
    const orderResult = await client.query(
      'SELECT * FROM group_orders WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [groupOrderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('拼单');
    const order = orderResult.rows[0];
    if (order.initiator_id !== userId) throw new ForbiddenError('仅发起人可取消');
    if (!['open', 'full', 'ongoing'].includes(order.status)) {
      throw new BadRequestError('当前状态不可取消');
    }
    // 退款给所有参与者
    const participants = await client.query(
      "SELECT user_id, amount FROM group_order_participants WHERE group_order_id = $1 AND status = 'paid'",
      [groupOrderId],
    );
    for (const p of participants.rows) {
      if (p.amount > 0) {
        await client.query('UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2', [p.amount, p.user_id]);
        await client.query(
          `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
           SELECT $1, 'refund', $2, credit_balance, $3, 'group_order', '拼单取消退还' FROM users WHERE id = $1`,
          [p.user_id, p.amount, groupOrderId],
        );
        await client.query(
          "UPDATE group_order_participants SET status = 'refunded' WHERE group_order_id = $1 AND user_id = $2",
          [groupOrderId, p.user_id],
        );
      }
    }
    await client.query("UPDATE group_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [groupOrderId]);
    return { id: groupOrderId, status: 'cancelled' };
  });
}
```

### P0-4：disputed 争议状态完全未实现

- **问题描述**：路由层 `skills.ts:59` 状态白名单包含 `disputed`，但 switch 语句（line 66-81）无 `disputed` 分支。service 层无任何 disputed 相关方法。DB 中 `service_disputes` 表（`001_init.sql:154-166`）仅关联 `time_orders`，未关联 `skill_orders`。
- **影响范围**：用户发生纠纷时无法发起争议，平台无介入手段
- **涉及文件**：[server/src/routes/skills.ts](file:///c:/work/traeaicansai/server/src/routes/skills.ts#L59-L81)、[server/src/services/skill-order.service.ts](file:///c:/work/traeaicansai/server/src/services/skill-order.service.ts)
- **修复建议**：在 `skill-order.service.ts` 新增 `disputeOrder` 方法，将订单置为 disputed 并冻结资金等待管理员介入。

### P0-5：expires_at 过期处理完全未实现

- **问题描述**：`skill_posts` 表有 `expires_at` 字段，createPost/updatePost 可写入，但：`getPostList` 仅过滤 `status = 'active'`，不排除已过期帖子；`createOrder` 下单时不检查帖子是否过期；定时任务无帖子过期处理。
- **影响范围**：过期帖子仍可被搜索、查看、下单，可能导致用户对已失效的服务下单后纠纷
- **涉及文件**：[server/src/services/skill.service.ts](file:///c:/work/traeaicansai/server/src/services/skill.service.ts#L50-L108)、[server/src/services/skill-order.service.ts](file:///c:/work/traeaicansai/server/src/services/skill-order.service.ts#L29-L46)、[server/src/jobs/scheduler.ts](file:///c:/work/traeaicansai/server/src/jobs/scheduler.ts)
- **修复建议**：(1) `getPostList` 查询条件增加 `(sp.expires_at IS NULL OR sp.expires_at > NOW())`；(2) `createOrder` 下单前校验过期；(3) scheduler 增加帖子过期处理任务。

### P0-6：应急求助超时无人响应无任何处理

- **问题描述**：`createRequest` 设置了 `timeout_at = NOW() + INTERVAL '30 minutes'`，但 `scheduler.ts:75-91` 只处理 `emergency_responses` 的超时，完全没有处理 `emergency_requests` 的超时。求助 30 分钟无人响应后将永远停留在 `open` 状态。
- **影响范围**：所有应急求助；用户发布后无人响应时求助永久挂起
- **涉及文件**：[server/src/services/emergency.service.ts](file:///c:/work/traeaicansai/server/src/services/emergency.service.ts#L109)、[server/src/jobs/scheduler.ts](file:///c:/work/traeaicansai/server/src/jobs/scheduler.ts#L75-L91)
- **修复建议**：在 scheduler 新增 `handleEmergencyRequestTimeout`，将超时且无任何 accepted 响应的求助置为 `expired`。

### P0-7：Token 黑名单基于内存 Map，多实例失效

- **问题描述**：`tokenBlacklist.ts:5` 使用 `Map` 内存存储。用户在实例A登出后，token 仅在 A 的黑名单中；请求路由到实例B时，`isBlacklisted` 返回 false，已登出的 token 仍可用。
- **影响范围**：多实例部署下登出失效，安全风险
- **涉及文件**：[server/src/utils/tokenBlacklist.ts](file:///c:/work/traeaicansai/server/src/utils/tokenBlacklist.ts#L5)
- **修复建议**：改用 Redis 实现，key 为 `blacklist:token`，TTL 设为 token 剩余有效期。

### P0-8：幂等性控制基于内存 Map，多实例失效

- **问题描述**：`idempotency.ts:13` 使用 `Map` 内存存储。`time-bank.service.ts:212` 和 `emergency.service.ts` 依赖此机制防止重复下单。多实例下幂等检查失效，可能导致重复扣款/重复下单。
- **影响范围**：多实例下重复提交导致资金/时间余额错误、重复订单
- **涉及文件**：[server/src/utils/idempotency.ts](file:///c:/work/traeaicansai/server/src/utils/idempotency.ts#L13)
- **修复建议**：改用 Redis SET NX EX 实现分布式幂等。

### P0-9：WebSocket 单实例方案，多实例消息无法投递

- **问题描述**：`websocket/index.ts:9` 使用 `Map` 存储用户连接。用户A连接到实例1，用户B连接到实例2，当A给B发消息时，实例1的 Map 中没有B的连接，消息无法投递。
- **影响范围**：多实例下跨实例用户间即时消息丢失
- **涉及文件**：[server/src/websocket/index.ts](file:///c:/work/traeaicansai/server/src/websocket/index.ts#L9)
- **修复建议**：引入 Redis pub/sub 跨实例广播。

### P0-10：手机号明文存储且 API 未脱敏

- **问题描述**：
  - `001_init.sql:8`：`phone VARCHAR(20) UNIQUE NOT NULL` 明文存储
  - `auth.service.ts:26` `toUserResponse` 直接返回 `row.phone`，未脱敏
  - `user.service.ts:21` `getProfile` 返回完整手机号
  - `emergency.service.ts:46` `toRequestResponse` 直接返回 `row.contact_phone`
  - JWT payload 中包含 `phone`（`auth.ts:12`），token 泄露即暴露手机号
- **影响范围**：数据库泄露直接暴露全部用户手机号；前端、日志、中间环节均可获取完整手机号，违背最小必要原则
- **涉及文件**：[database/migrations/001_init.sql](file:///c:/work/traeaicansai/database/migrations/001_init.sql#L8)、[server/src/services/auth.service.ts](file:///c:/work/traeaicansai/server/src/services/auth.service.ts#L26)、[server/src/middleware/auth.ts](file:///c:/work/traeaicansai/server/src/middleware/auth.ts#L12)
- **修复建议**：(1) 新建 `utils/crypto.ts` 使用 AES-256-GCM 加密手机号，新增 `phone_hash` 字段用于唯一性校验；(2) 新建 `utils/mask.ts` 实现 `maskPhone`，所有 API 响应中手机号脱敏；(3) JWT payload 移除 `phone`。

### P0-11：time-bank.service.ts updateService 存在 SQL 注入风险

- **问题描述**：`time-bank.service.ts:190-195` 中 `key` 直接拼入 SQL 字符串，未做白名单校验。对比其他服务（`user.service.ts`、`skill.service.ts`、`kitchen.service.ts`）都有白名单或硬编码字段名。
- **影响范围**：攻击者可构造恶意字段名注入 SQL，篡改任意字段
- **涉及文件**：[server/src/services/time-bank.service.ts](file:///c:/work/traeaicansai/server/src/services/time-bank.service.ts#L190-L195)
- **修复建议**：使用白名单过滤可更新字段：

```typescript
const allowedFields = ['type', 'category', 'title', 'description', 'duration_minutes', 'address', 'status'];
for (const field of allowedFields) {
  if (data[field] !== undefined) {
    fields.push(`${field} = $${paramIndex++}`);
    params.push(data[field]);
  }
}
```

### P0-12：操作审计日志完全缺失

- **问题描述**：全仓搜索 `audit|operation_log|loginLog|actionLog` 均无匹配。无审计日志表、无审计日志中间件。登录、注册、资金变动、订单状态变更、数据删除等敏感操作均无审计记录。
- **影响范围**：安全事件无法追溯；不满足 PIPL 第55条要求；合规审查不通过
- **涉及文件**：全项目（缺失）
- **修复建议**：新增 `audit_logs` 表与审计中间件，记录敏感操作的 user_id、action、resource、ip、user_agent、status 等。

### P0-13：容器化部署完全缺失

- **问题描述**：项目根目录不存在 `Dockerfile`、`docker-compose.yml`。`package.json:11` 的 `db:migrate` 脚本仅执行 `001_init.sql`，遗漏了 002、003 系列迁移。
- **影响范围**：无法一键部署，新环境数据库迁移不完整导致功能缺失
- **涉及文件**：项目根目录（缺失）、[server/package.json](file:///c:/work/traeaicansai/server/package.json#L11)
- **修复建议**：补充 Dockerfile、docker-compose.yml，修复 `db:migrate` 脚本按顺序执行所有迁移文件。

### P0-14：数据库迁移版本化管理缺失

- **问题描述**：`database/migrations/` 目录有 5 个 SQL 文件，但无迁移版本化管理工具。存在 3 个 `002_*` 前缀文件，执行顺序不明确。没有 `schema_migrations` 记录表，无法追踪已执行的迁移，重复执行会报错。
- **影响范围**：新环境部署表结构不完整；迁移不可追溯；无法回滚
- **涉及文件**：[database/migrations/](file:///c:/work/traeaicansai/database/migrations)
- **修复建议**：引入 `node-pg-migrate`，将现有 SQL 改造为带版本号的迁移文件。

### P0-15：credit.service.ts 完全未被调用，积分逻辑分散且不一致

- **问题描述**：`credit.service.ts` 的 `freezeCredits`/`unfreezeCredits`/`settleCredits` 定义后无任何调用方。各订单服务各自实现积分逻辑，导致：技能订单用 `freeze`，厨房订单用 `spend`，拼单用 `spend` 无冻结概念，类型不一致；取消时用 `unfreeze`/`refund` 不统一。
- **影响范围**：积分语义混乱；流水类型不可靠；后续对账、退款逻辑难以统一
- **涉及文件**：[server/src/services/credit.service.ts](file:///c:/work/traeaicansai/server/src/services/credit.service.ts)、各 order service
- **修复建议**：统一让所有订单服务调用 `credit.service.ts`，或删除该 service 并明确各模块语义。

### P0-16：freezeCredits 未加行锁，存在并发超扣

- **问题描述**：`credit.service.ts:8-11` 的 `freezeCredits` 在事务内 `SELECT credit_balance` 未使用 `FOR UPDATE`，两个并发请求可能同时读到相同余额，都通过校验后双扣，导致余额为负。
- **影响范围**：用户并发下单可超扣积分
- **涉及文件**：[server/src/services/credit.service.ts](file:///c:/work/traeaicansai/server/src/services/credit.service.ts#L8-L11)
- **修复建议**：`SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE`。

### P0-17：全项目无任何单元测试或集成测试

- **问题描述**：Glob 搜索 `*.test.ts`、`*.spec.ts` 均无结果。`package.json` 无 `test` 脚本，无测试框架依赖。
- **影响范围**：资金安全、权限校验等核心逻辑无回归保障，重构风险高
- **涉及文件**：全项目（缺失）
- **修复建议**：引入 `vitest` 或 `jest`，至少为积分结算事务、权限校验、限流、幂等性补充测试。

### P0-18：AI 能力完全未实现（项目核心卖点缺失）

- **问题描述**：规格 `project-spec.md` 第 6 节将 AI 作为项目核心能力（参赛 TRAE AI 创造力大赛），但代码中几乎完全未实现：
  - 智能匹配算法（NLP 语义匹配 + 距离权重 + 信誉分权重）— 未实现
  - 需求分类模型（文本预处理 + 类别识别 + 紧急程度）— 未实现
  - 安全风控系统（异常行为检测 + 内容审核 + 账号风险评估）— 未实现
  - 应急 AI 分级 — 仅关键词硬匹配，非 AI 模型
  - 时间银行服务匹配（P0 功能）— 未实现
  - 应急附近响应（300 米内推送，P0 功能）— 未实现
- **影响范围**：项目核心卖点缺失，与参赛定位严重不符
- **涉及文件**：全项目（缺失）
- **修复建议**：至少接入大模型 API 实现智能匹配与需求分类；应急分级改用 AI 模型；补齐应急附近响应推送。

---

## 三、重要问题（P1）

### P1-1：用户体系缺失多项关键流程

| 缺失流程 | 业务影响 | 涉及文件 |
|---------|---------|---------|
| 密码找回/重置 | 用户忘记密码后无法找回账号 | `server/src/routes/auth.ts`（无对应路由） |
| 实名认证 | DB 已有 `real_name`、`id_card_encrypted` 字段但无 API | `database/migrations/001_init.sql:12-13` |
| 用户封禁/申诉 | `authenticate` 校验 `status` 但无管理员封禁接口 | `server/src/middleware/auth.ts:59` |
| 账号注销 | DB 有 `deleted_at` 但无用户自助注销 API，PIPL 合规风险 | `server/src/services/auth.service.ts:76` |
| 修改密码 | 用户无法主动修改密码 | `server/src/routes/users.ts` |

### P1-2：requireRole 中间件定义但全项目未使用

- **问题描述**：`auth.ts:98-122` 定义了 `requireRole` 中间件，但搜索全项目无任何调用。`users` 表有 `role` 字段，但无任何管理员专属接口。
- **影响范围**：无管理员功能，无法进行用户管理、争议处理、内容审核
- **涉及文件**：[server/src/middleware/auth.ts](file:///c:/work/traeaicansai/server/src/middleware/auth.ts#L98-L122)
- **修复建议**：新增 `/admin` 路由，使用 `requireRole('admin')` 保护，提供用户封禁、争议处理、退款等管理功能。

### P1-3：cancelOrder 允许卖家负债绕过 MIN_BALANCE 设计

- **问题描述**：`skill-order.service.ts:247-265`，accepted 状态取消时，若卖家余额不足扣回，仍执行扣减允许余额为负，仅在 description 标注"负债"。这违背了 `MIN_BALANCE=10` 保护余额的一致性。卖家可累积巨额负债，无追偿机制，且负债卖家仍可继续接单、消费。
- **影响范围**：破坏积分系统完整性
- **涉及文件**：[server/src/services/skill-order.service.ts](file:///c:/work/traeaicansai/server/src/services/skill-order.service.ts#L247-L265)
- **修复建议**：卖家余额不足时拒绝取消，转争议流程由平台介入；或采用"挂账"模式记录应收账款。

### P1-4：时间银行日收益上限检查时机导致已完成服务无法结算

- **问题描述**：`time-bank.service.ts:290-293` 先更新订单状态为 completed，line 320-329 再检查日收益上限。虽然事务会回滚，但用户已经实际完成服务，却因为上限检查失败导致整个订单无法完成。provider 当日收益接近 480 分钟时，新订单无法完成；requester 已提供服务时间，但 provider 收不到积分。
- **影响范围**：用户体验极差：服务已完成却显示"订单状态不允许此操作"
- **涉及文件**：[server/src/services/time-bank.service.ts](file:///c:/work/traeaicansai/server/src/services/time-bank.service.ts#L290-L329)
- **修复建议**：在 `createOrder` 或 `start` 阶段预检查；或对超出上限部分延后发放（记为 pending，次日由 scheduler 发放）。

### P1-5：家庭绑定（代际互助）功能形同虚设

- **问题描述**：`time-bank.service.ts:484-563` 实现了 `createFamilyBinding`、`confirmFamilyBinding` 等函数，但绑定确认后没有任何后续业务功能。没有代际转账、共享账户、代下单、家庭时间池。"代际互助"作为产品卖点完全未实现。
- **影响范围**：核心产品价值缺失
- **涉及文件**：[server/src/services/time-bank.service.ts](file:///c:/work/traeaicansai/server/src/services/time-bank.service.ts#L484-L563)
- **修复建议**：至少实现代际转账（父母可为子女转账时间积分）或家庭时间池。

### P1-6：争议处理无闭环，创建后无人处理

- **问题描述**：`time-bank.service.ts:598-666` 仅有 `createDispute` 和 `getDisputes`，无 `resolveDispute`。争议永远停留在 `pending` 状态，`resolved_by`、`resolved_at`、`resolution` 字段永远不会被填充。其他模块（skill/kitchen/emergency）完全没有争议/申诉接口。
- **影响范围**：用户被恶意差评后无法申诉；争议无法处理
- **涉及文件**：[server/src/services/time-bank.service.ts](file:///c:/work/traeaicansai/server/src/services/time-bank.service.ts#L598-L666)
- **修复建议**：新增管理员争议处理接口，支持退款、改评、扣分等处置。

### P1-7：虚假举报无审核与处罚流程

- **问题描述**：`emergency.service.ts:375-402` 仅向 `false_reports` 表插入 `status='pending'` 记录，没有任何审核接口、处罚逻辑。`false_reports` 表有 `penalty`、`resolved_at`、`resolved_by` 字段但从未被写入。
- **影响范围**：举报功能形同虚设，无法惩罚恶意虚假求助
- **涉及文件**：[server/src/services/emergency.service.ts](file:///c:/work/traeaicansai/server/src/services/emergency.service.ts#L375-L402)
- **修复建议**：新增管理员审核接口，由 `requireRole('admin')` 鉴权，更新状态并对被举报者执行扣分/封禁。

### P1-8：应急资源缺少 CRUD 接口

- **问题描述**：`emergency-resource.service.ts` 只导出 `getResources` 和 `getResourceById`，没有任何创建、更新、删除接口，`last_check` 字段也从未被更新。
- **影响范围**：应急资源信息无法维护，资源状态永远是初始值
- **涉及文件**：[server/src/services/emergency-resource.service.ts](file:///c:/work/traeaicansai/server/src/services/emergency-resource.service.ts)
- **修复建议**：新增管理员 CRUD 接口，并增加定期巡检任务更新 `last_check`。

### P1-9：多人响应无协调机制

- **问题描述**：`respondToRequest` 允许任意多个用户响应同一求助，`updateResponseStatus` 完成订单时直接将 `emergency_requests` 置为 `resolved`，但其他响应者的 `emergency_responses` 记录状态不变，既无通知也无补偿。
- **影响范围**：多人响应时资源浪费；其他响应者无法感知求助已被解决；可能产生重复完成
- **涉及文件**：[server/src/services/emergency.service.ts](file:///c:/work/traeaicansai/server/src/services/emergency.service.ts#L245-L289)
- **修复建议**：完成订单时在事务内将其他 `accepted` 响应置为 `cancelled`，并通过消息系统通知。

### P1-10：应急完成未更新响应者信誉分

- **问题描述**：`updateResponseStatus` 完成订单时插入了 `reviews` 记录，但没有调用 `reputationService.updateReputationScore`。而 `skill-order.service.ts:192`、`kitchen-order.service.ts:222`、`time-bank.service.ts:373` 都有调用。
- **影响范围**：应急响应者的信誉分永远不会变化
- **涉及文件**：[server/src/services/emergency.service.ts](file:///c:/work/traeaicansai/server/src/services/emergency.service.ts#L338-L370)
- **修复建议**：在事务内 `reviewData` 存在时追加 `await reputationService.updateReputationScore(client, response.responder_id)`。

### P1-11：文件上传流程完全缺失

- **问题描述**：搜索 `upload|multer|OSS` 在 `server/src` 下无任何匹配。`skill_posts.images`、`kitchen_posts.images`、`emergency_requests.images` 都是 `TEXT[]` 字段，但服务端没有任何上传接口。
- **影响范围**：前端只能填写 URL 字符串，没有统一的上传/存储/鉴权方案，存在安全风险
- **涉及文件**：全项目
- **修复建议**：新增 `/api/upload` 接口，使用 `multer` + 对象存储（OSS/S3），返回 URL 后再由业务接口保存；对 URL 做白名单校验。

### P1-12：消息通知仅有订单内聊天，无站内信/推送

- **问题描述**：`message.service.ts` 仅支持订单维度聊天；`websocket/index.ts` 仅处理 `chat` 类型消息。订单状态变更、求助响应、举报结果等关键事件都没有任何通知。
- **影响范围**：用户体验差；关键业务事件用户无法及时感知
- **涉及文件**：[server/src/services/message.service.ts](file:///c:/work/traeaicansai/server/src/services/message.service.ts)、[server/src/websocket/index.ts](file:///c:/work/traeaicansai/server/src/websocket/index.ts)
- **修复建议**：新增 `notifications` 表与 service，在关键业务事件触发站内信，并通过 WebSocket 推送 `notification` 类型消息。

### P1-13：积分系统无对账机制

- **问题描述**：搜索全项目没有定期对账、余额校验逻辑。`credit_transactions.balance_after` 字段虽被记录，但没有任务校验与 `users.credit_balance` 是否一致。
- **影响范围**：积分凭空增减、流水漏记等问题无法被发现
- **涉及文件**：全项目
- **修复建议**：新增每日对账定时任务，校验每个用户最近一条流水的 `balance_after` 等于 `users.credit_balance`，不一致时告警。

### P1-14：环境变量生产校验机制缺失

- **问题描述**：`env.ts` 对 `JWT_SECRET` 和 `DB_PASSWORD` 做了强制校验，但 `REDIS_PASSWORD` 默认空字符串，`CORS_ORIGIN` 默认 localhost，`JWT_EXPIRES_IN` 默认 7d 过长。缺少 `NODE_ENV=production` 时的强校验。
- **影响范围**：生产环境配置错误会导致 Redis 无认证、CORS 策略失效、Token 风险暴露窗口过长
- **涉及文件**：[server/src/config/env.ts](file:///c:/work/traeaicansai/server/src/config/env.ts#L32-L40)
- **修复建议**：在 env.ts 末尾增加生产环境强校验。

### P1-15：优雅关闭逻辑不完整

- **问题描述**：`index.ts:60-66` 实现了 SIGTERM 处理，但仅调用 `server.close()`，未关闭 WebSocket、数据库连接池、Redis 连接，未停止定时任务调度器，没有超时强制退出机制。
- **影响范围**：滚动更新时连接异常断开、资源泄漏、定时任务重复执行
- **涉及文件**：[server/src/index.ts](file:///c:/work/traeaicansai/server/src/index.ts#L60-L66)
- **修复建议**：增加 10 秒超时强制退出，依次关闭 Redis、连接池、cron 任务。

### P1-16：日志体系不统一，SQL 日志可能泄露敏感数据

- **问题描述**：全仓共 50 处 `console.log/error` 调用，格式混乱。`database.ts:32` 在 development 环境打印所有 SQL 语句及参数，可能泄露敏感数据（如手机号、密码哈希）。缺少 `LOG_LEVEL` 环境变量控制，没有日志收集方案。
- **影响范围**：生产环境日志难以收集、检索、告警；敏感数据可能泄露到日志
- **涉及文件**：[server/src/config/database.ts](file:///c:/work/traeaicansai/server/src/config/database.ts#L32)
- **修复建议**：引入 `pino` 或 `winston` 统一日志框架，SQL 日志应脱敏或仅记录文本不记录参数值。

### P1-17：数据库连接池配置不可配置且缺少超时控制

- **问题描述**：`database.ts:5-14` 连接池 `max: 20` 硬编码，不可通过环境变量配置。缺少 `statement_timeout`，慢查询可能长期占用连接。多实例部署时，N 实例 × 20 连接可能超过 PostgreSQL 默认 `max_connections=100`。
- **影响范围**：多实例部署连接数超限；慢查询耗尽连接池
- **涉及文件**：[server/src/config/database.ts](file:///c:/work/traeaicansai/server/src/config/database.ts#L5-L14)
- **修复建议**：`max` 改为环境变量配置，添加 `statement_timeout=30000` 和 `idle_in_transaction_session_timeout=60000`。

### P1-18：PIPL 合规性多项缺失

- **问题描述**：(1) 注册接口未记录用户同意隐私政策的版本和时间；(2) 应急模块收集 contact_phone、location 等敏感信息无数据分类分级；(3) 软删除数据仍保留，无彻底删除/匿名化机制；(4) 无数据保留期限策略；(5) 无隐私政策查询接口。
- **影响范围**：PIPL 合规审查不通过；用户行使删除权时无法满足
- **涉及文件**：[database/migrations/001_init.sql](file:///c:/work/traeaicansai/database/migrations/001_init.sql#L6-L22)、[server/src/services/auth.service.ts](file:///c:/work/traeaicansai/server/src/services/auth.service.ts#L36-L72)
- **修复建议**：users 表增加 `privacy_consent_version`、`privacy_consent_at` 字段；新增 `data_deletion_requests` 表；实现数据匿名化清理任务。

### P1-19：health_cert/allergens 无强制校验

- **问题描述**：`kitchen.ts:30` 过敏原为可选；路由层完全没有 `health_cert` 字段校验；`kitchen.service.ts:70` 默认 false。用户可发布无健康证、无过敏原标识的食品，对过敏体质用户存在健康威胁。
- **影响范围**：食品安全合规风险
- **涉及文件**：[server/src/routes/kitchen.ts](file:///c:/work/traeaicansai/server/src/routes/kitchen.ts#L22-L31)、[server/src/services/kitchen.service.ts](file:///c:/work/traeaicansai/server/src/services/kitchen.service.ts#L37-L75)
- **修复建议**：对 `type === 'offer'` 的美食分享强制要求 `health_cert === true`；强制要求填写 `allergens`。

### P1-20：时间银行 transferTime/completeOrder 中 users.time_balance 更新没有行锁

- **问题描述**：`time-bank.service.ts:415-441` 和 `295-341` 更新 `users.time_balance` 但未对 `users` 表加 `FOR UPDATE` 锁。`getOrCreateAccount` 只锁了 `time_accounts`。并发转账或完成订单时 `users.time_balance` 可能丢失更新。
- **影响范围**：`time_accounts.balance` 与 `users.time_balance` 可能不一致
- **涉及文件**：[server/src/services/time-bank.service.ts](file:///c:/work/traeaicansai/server/src/services/time-bank.service.ts#L415-L441)
- **修复建议**：在事务内补充对 `users` 表的行锁。

### P1-21：time_accounts 与 users.time_balance 双重存储一致性风险

- **问题描述**：时间余额同时存储在 `time_accounts.balance` 和 `users.time_balance` 两张表中。每次变动需同时更新两处，任何一处漏更新都会导致不一致。`getAccount` 返回 `time_accounts.balance`，但其他模块可能读取 `users.time_balance`，两处不一致会导致用户看到不同的余额。
- **影响范围**：数据一致性风险
- **涉及文件**：[server/src/services/time-bank.service.ts](file:///c:/work/traeaicansai/server/src/services/time-bank.service.ts#L331-L341)
- **修复建议**：长期方案统一为单一数据源，去掉 `users.time_balance`；短期确保所有更新路径都同时更新两表并加锁。

### P1-22：厨房订单 confirmed 状态无超时处理

- **问题描述**：`scheduler.ts:40-53` 仅处理 `pending` 状态超过 30 分钟的订单。`confirmed` 状态的订单如果买家长期不点击完成，将永久停留在 `confirmed` 状态，卖家积分永远无法到账。
- **影响范围**：卖家已确认并提供服务，但积分永远无法到账
- **涉及文件**：[server/src/jobs/scheduler.ts](file:///c:/work/traeaicansai/server/src/jobs/scheduler.ts#L40-L53)
- **修复建议**：增加 `confirmed` 状态超时自动完成逻辑（如 24 小时后自动完成）。

### P1-23：定时任务覆盖不全且超时规则不合理

- **问题描述**：`scheduler.ts` 只覆盖 skill/kitchen/time/emergency_response 四类超时，缺失：拼单截止超时、应急求助超时、技能订单 `in_progress` 状态超时、时间银行 `accepted`/`in_progress` 状态超时。技能订单 `accepted` 7 天自动完成对卖家不公平。
- **影响范围**：多个模块存在订单永久挂起风险
- **涉及文件**：[server/src/jobs/scheduler.ts](file:///c:/work/traeaicansai/server/src/jobs/scheduler.ts)
- **修复建议**：补全各模块各状态的超时处理。

### P1-24：紧急程度关键词匹配覆盖度低且与 schema 不一致

- **问题描述**：`classifyUrgency` 关键词极少（critical 7 个、high 5 个、medium 4 个），且 `low` 与 schema 默认值 `normal` 不一致。匹配顺序依赖 JS 对象插入顺序，脆弱。
- **影响范围**：误判风险高
- **涉及文件**：[server/src/services/emergency.service.ts](file:///c:/work/traeaicansai/server/src/services/emergency.service.ts#L19-L33)
- **修复建议**：扩充关键词库；按严重度从高到低显式排序匹配；统一 schema 默认值。

### P1-25：应急响应积分奖励机制不合理

- **问题描述**：奖励由求助者确认完成时一次性发放给响应者，但求助者无需支付积分，属于凭空增发；多人响应时只有被完成的一个响应者获奖，其他响应者付出成本无补偿；5 星奖励由求助者主观评分决定，易被刷分。
- **影响范围**：积分通胀；多人响应时响应者积极性受挫；存在刷分风险
- **涉及文件**：[server/src/services/emergency.service.ts](file:///c:/work/traeaicansai/server/src/services/emergency.service.ts#L334-L367)
- **修复建议**：引入应急互助基金或求助者预付积分；对其他有效响应者给予少量补偿；对 5 星奖励增加防刷限制。

### P1-26：时间银行创建订单不冻结时间余额

- **问题描述**：`createOrder` 仅插入订单记录，不冻结 requester 的时间余额。`completeOrder` 才检查余额，若不足直接失败。requester 可以下无数个订单，但完成时才发现余额不足，provider 服务时间被浪费。
- **影响范围**：provider 利益受损；requester 可恶意下单
- **涉及文件**：[server/src/services/time-bank.service.ts](file:///c:/work/traeaicansai/server/src/services/time-bank.service.ts#L210-L231)
- **修复建议**：`createOrder` 时冻结 `service.duration_minutes` 时间余额，取消时解冻。

### P1-27：应急 GET /emergency/requests/:id 泄露手机号

- **问题描述**：使用 `optionalAuth`，但返回 `contactPhone` 字段，未登录用户也可获取手机号。
- **影响范围**：敏感信息泄露
- **涉及文件**：[server/src/routes/emergency.ts](file:///c:/work/traeaicansai/server/src/routes/emergency.ts#L18)、[server/src/services/emergency.service.ts](file:///c:/work/traeaicansai/server/src/services/emergency.service.ts#L46)
- **修复建议**：对未登录用户或非响应者隐藏 `contactPhone`；仅在实际响应后才返回。

### P1-28：无 API 文档（Swagger/OpenAPI）

- **问题描述**：Grep 搜索 `swagger`、`openapi` 均无结果。
- **影响范围**：前后端协作困难；外部集成无文档参考
- **修复建议**：接入 `swagger-jsdoc` + `swagger-ui-express`。

### P1-29：无 CI/CD 配置

- **问题描述**：Glob 搜索 `.github`、`.gitlab-ci.yml` 均无结果。`package.json` 无 `lint`、`typecheck` 脚本。
- **影响范围**：代码质量无自动化保障
- **修复建议**：新增 GitHub Actions：lint + typecheck + 测试 + 构建产物。

### P1-30：错误码与规格不一致

- **问题描述**：规格要求错误码为数字（200/400/401/403/404/429/500），但实际响应 `code` 为字符串（如 `'BAD_REQUEST'`）。`success` 响应中 `code` 为数字 `200`，错误响应中 `code` 为字符串，前后端类型不一致。
- **影响范围**：前后端契约不一致
- **修复建议**：与产品确认错误码规范，统一为数字或字符串。

---

## 四、流程完整性缺口

### 4.1 用户体系

| 缺失流程 | 业务影响 | 严重级别 |
|---------|---------|---------|
| 密码找回/重置 | 用户忘记密码后无法找回账号，需人工介入 | P1 |
| 实名认证 | DB 已有字段但无 API，高风险场景无法核验身份 | P1 |
| 用户封禁/申诉 | `authenticate` 校验 `status` 但无管理员封禁接口 | P1 |
| 账号注销 | 无用户自助注销 API，PIPL 合规风险 | P1 |
| 修改密码/手机号 | 用户无法主动修改 | P1/P2 |

### 4.2 技能交换模块

| 缺失流程 | 业务影响 | 严重级别 |
|---------|---------|---------|
| disputed 争议处理 | 用户发生纠纷时无法发起争议，平台无介入手段 | P0 |
| expires_at 过期处理 | 过期帖子仍可被搜索、查看、下单 | P0 |
| in_progress 状态流转 | 状态机断链，completeOrder 中的 in_progress 判断是死代码 | P1 |
| 退款失败补偿机制 | 退款异常时无补偿 | P1 |

### 4.3 共享厨房模块

| 缺失流程 | 业务影响 | 严重级别 |
|---------|---------|---------|
| 拼单取消/退款/完成/结算 | 参与者积分被永久锁定，拼单成功后卖家收不到积分 | P0 |
| 拼单未达最低人数处理 | 拼单失败后无退款 | P0 |
| 健康证/过敏原强制校验 | 食品安全合规风险 | P1 |
| confirmed 状态超时处理 | 卖家积分永久无法结算 | P1 |

### 4.4 时间银行模块

| 缺失流程 | 业务影响 | 严重级别 |
|---------|---------|---------|
| 家庭绑定联动功能 | "代际互助"产品卖点完全未实现 | P1 |
| 争议处理闭环 | 争议创建后无人处理 | P1 |
| in_progress 状态取消 | 服务开始后发生纠纷无法终止 | P1 |
| accepted/in_progress 超时处理 | 订单可能永久停留 | P1 |
| 创建订单冻结余额 | requester 可恶意下单，provider 服务时间被浪费 | P1 |

### 4.5 应急邻里模块

| 缺失流程 | 业务影响 | 严重级别 |
|---------|---------|---------|
| 求助超时无人响应处理 | 求助永久挂起 | P0 |
| 应急响应超时后求助状态回退 | 求助者无法重新获得响应 | P0 |
| 虚假举报审核与处罚 | 举报功能形同虚设 | P1 |
| 应急资源 CRUD | 资源信息无法维护 | P1 |
| 多人响应协调机制 | 资源浪费，可能重复完成 | P1 |
| 应急完成更新信誉分 | 应急响应者信誉分永远不变 | P1 |

### 4.6 公共流程

| 缺失流程 | 业务影响 | 严重级别 |
|---------|---------|---------|
| 拼单模块全流程 | 见 4.3 | P0 |
| 文件上传（图片） | 无统一上传/存储/鉴权方案 | P1 |
| 站内信/推送通知 | 关键业务事件用户无法及时感知 | P1 |
| 评价后申诉机制 | 被恶意差评后无法申诉 | P1 |
| 积分系统对账机制 | 积分凭空增减无法被发现 | P1 |

---

## 五、流程合理性问题

### 5.1 业务逻辑合理性

| 问题 | 改进方案 | 严重级别 |
|------|---------|---------|
| 积分保护余额（MIN_BALANCE=10）被 cancelOrder 允许卖家负债绕过 | 卖家余额不足时拒绝取消，转争议流程 | P1 |
| 时间银行日收益上限检查时机导致已完成服务无法结算 | 预检查或延后发放超出部分 | P0 |
| 应急紧急程度仅靠关键词匹配，覆盖度低且与 schema 不一致 | 扩充关键词库或改用 AI 模型 | P1 |
| 应急奖励积分凭空增发，无来源 | 设立系统应急基金账户或要求求助者预付 | P1 |
| 5 星好评奖励可被滥用（串通互刷） | 增加反刷分机制 | P2 |
| 信誉分仅取近 50 条评价平均，无时间衰减/评价者权重 | 引入时间衰减因子和评价者信誉权重 | P2 |
| MIN_BALANCE 常量在 credit.service.ts 和 skill-order.service.ts 重复定义 | 抽取到 config/constants.ts | P2 |

### 5.2 状态机合理性

| 问题 | 改进方案 | 严重级别 |
|------|---------|---------|
| 技能订单 in_progress 状态断链 | 增加 startOrder 方法或移除 in_progress 相关代码 | P1 |
| 时间银行 in_progress 状态无法取消 | 允许双方同意下取消 | P1 |
| 应急响应状态机缺失关键校验，可从任意状态跳到 completed | 严格校验 accepted/arrived → completed | P0 |
| 厨房订单 confirm 无事务无行锁 | 使用 transaction + FOR UPDATE | P1 |
| 时间银行 updateOrderStatus 无事务无行锁 | 使用 transaction + FOR UPDATE | P1 |
| 应急 respondToRequest 多写操作不在事务内 | 包裹在 transaction 中 | P1 |

### 5.3 用户体验合理性

| 问题 | 改进方案 | 严重级别 |
|------|---------|---------|
| API 错误信息部分不友好（如"订单状态不允许此操作"） | 细化错误信息 | P2 |
| 分页参数设计基本一致，但 page 无上限，可触发深分页 | 限制 page 最大值 | P2 |
| 列表查询普遍使用 JOIN 避免 N+1（良好） | — | — |
| WebSocket 无断线重连机制 | 前端实现自动重连 | P2 |
| 错误码与规格不一致（数字 vs 字符串） | 统一规范 | P1 |

### 5.4 资金/积分安全

| 问题 | 改进方案 | 严重级别 |
|------|---------|---------|
| 技能订单 createOrder 双花漏洞 | 事务内加行锁 | P0 |
| 应急完成可重复发积分 | FOR UPDATE + 状态校验 | P0 |
| 拼单无退款机制 | 补充 cancel/refund 函数 | P0 |
| credit.service.ts 死代码，积分逻辑分散 | 统一调用 credit.service.ts | P0 |
| freezeCredits 未加行锁 | 加 FOR UPDATE | P0 |
| rejectOrder 退款未对买家加行锁 | 加 FOR UPDATE | P1 |
| settleCredits 买家 balance_after 记录可能错误 | 明确标注为"结算确认"类型 | P1 |
| 时间银行 earn 流水 from_user_id 为 NULL | 填 order.requester_id | P2 |
| 注册奖励流水未记录 reference_id/reference_type | 补充 reference_type='register' | P2 |

---

## 六、细节优化建议（P2）

### 6.1 性能优化

| 问题 | 文件 / 行号 | 修复建议 |
|------|------------|---------|
| `getRequestById` 循环调用 `checkTimeout`，每条记录可能触发 UPDATE | `emergency.service.ts:218-224` | 批量 UPDATE 或交由 scheduler 处理 |
| 定时任务循环中调用 service 函数，每次启动独立事务 | `scheduler.ts:21-37` | 批量查询后单事务批量更新 |
| Redis 已配置但业务侧无任何调用 | `redis.ts:52-91` | 接入用户信息缓存、帖子详情缓存、Token 黑名单 |
| `messages` 表缺少 `(receiver_id, order_type, read_at)` 复合索引 | `001_init.sql:262` | 新增复合索引 |
| `time_orders` 缺少 `(provider_id, status)` 复合索引 | `001_init.sql:255-256` | 新增复合索引 |
| `reviews` 表缺少 `(order_id, reviewer_id)` 唯一索引 | `001_init.sql:261` | 新增 UNIQUE 约束 |
| 所有列表查询使用 OFFSET 分页，深分页性能差 | 各 service getList | 时间序列列表改用游标分页 |
| `getSortParams` 已实现但无任何业务调用 | `validator.ts:82-89` | 接入帖子/订单列表排序 |

### 6.2 代码质量

| 问题 | 文件 / 行号 | 修复建议 |
|------|------------|---------|
| 全项目 60+ 处 `: any` 或 `as any` | `server/src/services/*.ts` | 为 DB 行定义 TS 接口 |
| 分页响应构造逻辑分裂为两套 | `skill.service.ts`、`kitchen.service.ts` 等 | 统一使用 `createPaginatedResponse` |
| `time-bank.service.ts` 入参使用 snake_case | `time-bank.service.ts:65-68` | 改为 camelCase，service 内转换 |
| `rules`、`getSortParams`、`notFoundHandler`、`error`、`noContent` 等死代码 | `validator.ts`、`errorHandler.ts`、`response.ts` | 删除或接入 |
| `requireRole`、`smsLimiter`、`searchLimiter` 定义但未使用 | `auth.ts`、`rateLimiter.ts` | 接入或删除 |
| `review.service.ts` 与 `reputation.service.ts` 信誉分计算逻辑重复 | `review.service.ts:21-37` | 统一使用 `reputationService` |
| `checkTimeout` 在 service 层 try/catch 吞掉错误 | `emergency.service.ts:171-181` | 改为抛出错误 |
| `kitchen.ts:208-241` 路由层直接写 SQL | `kitchen.ts:208-241` | 移到 review.service.ts |

### 6.3 安全加固

| 问题 | 文件 / 行号 | 修复建议 |
|------|------------|---------|
| `GET /time-bank/services/:id` 无任何鉴权 | `time-bank.ts:18` | 改为 `optionalAuth` 或 `authenticate` |
| `GET /emergency/resources/:id` 无鉴权，泄露应急资源位置与电话 | `emergency.ts:83` | 至少 `optionalAuth`，对 contactPhone 脱敏 |
| `updateService` 未做字段白名单校验（见 P0-11） | `time-bank.service.ts:190-195` | 使用白名单 |
| `kitchen.service.ts` update 允许客户端直接修改 status | `kitchen.service.ts:107-109` | 移除 status 字段直接更新 |
| `/auth/refresh-token` 无限流 | `auth.ts:33` | 加 `authLimiter` |
| `/time-bank/transfer` 转账无限流 | `time-bank.ts:74` | 加 `orderLimiter` |
| `/emergency/false-reports` 举报无限流 | `emergency.ts:67` | 加 `createPostLimiter` |
| 用户输入字段未做 HTML 转义或 XSS 过滤 | 全项目 service 层 | 入库前使用 `xss` 库过滤 |
| `images` 字段直接存储前端传入的 URL，未校验 | `skill.service.ts:13` 等 | 校验 URL 必须为 HTTPS + 域名白名单 |
| JSON body 限制 10MB 对文本接口过大 | `index.ts:29` | 区分接口类型设置不同 limit |

### 6.4 可维护性

| 问题 | 修复建议 |
|------|---------|
| 无单元测试/集成测试（见 P0-17） | 引入 vitest，覆盖积分结算、权限校验 |
| 无 API 文档（见 P1-28） | 接入 swagger-jsdoc |
| 无 CI/CD（见 P1-29） | 新增 GitHub Actions |
| `package.json` 无 `lint`、`typecheck` 脚本 | 新增 `"lint": "eslint src"`、`"typecheck": "tsc --noEmit"` |
| 错误码缺少业务错误码定义 | 为高频业务错误定义专用 code |
| `.env.example` 缺少运维配置项文档 | 补充 LOG_LEVEL、DB_POOL_MAX 等 |

---

## 七、未实现的规格功能

对照 `docs/project-spec.md` 及 `docs/modules/*.md`，以下规格中提到的功能在代码中未实现：

### 7.1 AI 能力（项目核心卖点，几乎完全未实现）

| 规格位置 | 规格要求 | 实现情况 | 级别 |
|---------|---------|---------|------|
| `project-spec.md` 6.1 | 智能匹配算法（NLP 语义匹配 + 距离权重 + 信誉分权重） | ❌ 完全未实现 | P0 |
| `project-spec.md` 6.2 | 需求分类模型（文本预处理 + 类别识别 + 紧急程度） | ❌ 完全未实现 | P0 |
| `project-spec.md` 6.3 | 安全风控系统（异常行为检测 + 内容审核 + 账号风险评估） | ❌ 完全未实现 | P0 |
| `skill-exchange-spec.md` 6.1 | 智能推荐 | ❌ 未实现 | P1 |
| `shared-kitchen-spec.md` 6.1 | 食品安全 AI 检查 | ❌ 未实现 | P1 |
| `shared-kitchen-spec.md` 6.2 | 美食推荐算法 | ❌ 未实现 | P2 |
| `time-bank-spec.md` 6.1 | 服务匹配算法 | ❌ 未实现 | P0 |
| `time-bank-spec.md` 6.2 | 智能分类 | ❌ 未实现 | P1 |
| `emergency-neighbor-spec.md` 6.1 | 紧急程度 AI 分级 | ⚠️ 仅关键词硬匹配，非 AI | P1 |
| `emergency-neighbor-spec.md` 6.2 | 智能推送策略 | ❌ 未实现 | P0 |
| `emergency-neighbor-spec.md` 6.3 | 虚假求助检测 | ❌ 未实现 | P1 |

### 7.2 核心模块功能缺失

| 规格位置 | 规格要求 | 实现情况 | 级别 |
|---------|---------|---------|------|
| `emergency-neighbor-spec.md` 2.1 | 附近响应（300 米内推送） | ❌ 未实现 | P0 |
| `emergency-neighbor-spec.md` 2.1 | 紧急联系人自动通知 | ❌ 未实现 | P1 |
| `project-spec.md` 4.2 | 消息服务：站内信、推送通知 | ⚠️ 仅 WebSocket 实时通讯 | P1 |
| `project-spec.md` 4.2 | 信誉服务：信誉等级体系 | ⚠️ 仅平均分计算 | P2 |
| `skill-exchange-spec.md` 2.1 | 举报功能 | ❌ 技能模块未实现 | P1 |
| `skill-exchange-spec.md` 2.2 | 技能分类管理、内容审核、用户管理、数据统计 | ❌ 无管理后台 | P1 |
| `time-bank-spec.md` 2.1 | 资质认证 | ❌ 未实现审核流程 | P1 |

### 7.3 非功能性需求未达成

| 规格位置 | 规格要求 | 实现情况 | 级别 |
|---------|---------|---------|------|
| `project-spec.md` 7.1 | API 响应时间 < 200ms (P95) | ⚠️ 无性能测试；authenticate 每次查 DB | P1 |
| `project-spec.md` 7.1 | 并发用户数 1000+ | ⚠️ 连接池 max=20，单实例部署 | P1 |
| `project-spec.md` 7.2 | 用户数据加密存储 AES-256 | ❌ id_card_encrypted 字段存在但无加密代码 | P0 |
| `project-spec.md` 7.2 | 敏感信息脱敏展示 | ⚠️ 仅应急匿名发布脱敏，手机号未脱敏 | P1 |
| `project-spec.md` 7.2 | 日志审计 | ⚠️ 有错误日志，无操作审计日志 | P1 |
| `project-spec.md` 7.3 | 服务可用性 > 99.9% | ❌ 单实例部署，无负载均衡 | P1 |
| `project-spec.md` 7.3 | 数据备份：每日全量 + 实时增量 | ❌ 未实现 | P1 |
| `project-spec.md` 2.2 | MongoDB（日志存储） | ❌ 未使用 | P2 |
| `project-spec.md` 2.2 | OSS 存储（文件） | ❌ 未使用 | P2 |
| `project-spec.md` 2.2 | 高德地图 API | ❌ 未使用 | P1 |
| `project-spec.md` 2.2 | 极光推送 | ❌ 未使用 | P1 |
| `project-spec.md` 2.2 | Taro 4 小程序 | ❌ 前端仅 React H5 | P2 |

### 7.4 数据模型差异

| 规格位置 | 规格要求 | 实现情况 | 级别 |
|---------|---------|---------|------|
| `project-spec.md` 5.2 | `users.id_card` 加密存储 | ⚠️ 字段名为 `id_card_encrypted` 但无加密逻辑 | P2 |
| `project-spec.md` 5.2 | `help_requests` 统一互助请求表 | ❌ 各模块各自实现帖子表 | P3 |
| `skill-exchange-spec.md` 3.2 | `skill_categories` 表（二级分类） | ❌ 使用 VARCHAR category 字段 | P2 |
| `shared-kitchen-spec.md` 3.3 | `food_reviews` 表含细分评分 | ❌ 使用统一 reviews 表 | P2 |
| `emergency-neighbor-spec.md` 3.6 | `false_reports.penalty` 处罚执行 | ⚠️ 字段存在但无处罚逻辑 | P2 |

---

## 八、上线前检查清单

### 资金/积分安全（必须）

- [ ] 修复技能订单 createOrder 双花漏洞（事务内加行锁）
- [ ] 修复应急完成可重复发积分（FOR UPDATE + 状态校验）
- [ ] 补充拼单 cancel/refund/complete 全流程
- [ ] 统一调用 credit.service.ts 或删除死代码并明确各模块语义
- [ ] 修复 freezeCredits 未加行锁
- [ ] 补充积分对账定时任务
- [ ] 修复时间银行 transferTime/completeOrder 中 users.time_balance 无行锁

### 数据安全与合规（必须）

- [ ] 手机号加密存储（AES-256-GCM + phone_hash）
- [ ] API 响应中手机号脱敏
- [ ] JWT payload 移除 phone
- [ ] 修复 time-bank updateService SQL 注入
- [ ] 新增操作审计日志表与中间件
- [ ] 注册接口记录隐私政策同意版本与时间
- [ ] 实现账号注销/数据匿名化流程

### 多实例与扩展性（必须）

- [ ] Token 黑名单改用 Redis 实现
- [ ] 幂等性缓存改用 Redis 实现
- [ ] WebSocket 引入 Redis pub/sub 跨实例广播
- [ ] 数据库连接池 max 改为环境变量配置
- [ ] 添加 statement_timeout 和 idle_in_transaction_session_timeout

### 核心流程完整性（必须）

- [ ] 实现技能订单 disputed 争议处理流程
- [ ] 实现 expires_at 过期处理（查询过滤 + 定时任务）
- [ ] 实现应急求助超时处理
- [ ] 实现应急响应超时后求助状态回退
- [ ] 实现时间银行争议处理闭环
- [ ] 实现虚假举报审核与处罚流程
- [ ] 实现应急资源 CRUD
- [ ] 实现多人响应协调机制
- [ ] 修复时间银行日收益上限检查时机
- [ ] 补全定时任务覆盖（拼单超时、各状态超时）

### 部署与运维（必须）

- [ ] 补充 Dockerfile 和 docker-compose.yml
- [ ] 引入 node-pg-migrate 迁移版本化管理
- [ ] 修复 db:migrate 脚本执行所有迁移文件
- [ ] 完善优雅关闭（关闭 WS/DB/Redis/cron + 超时强制退出）
- [ ] 引入 pino/winston 统一日志框架
- [ ] SQL 日志脱敏
- [ ] 添加生产环境环境变量强校验
- [ ] 添加 /ready 就绪检查端点

### 测试与质量（必须）

- [ ] 引入 vitest 测试框架
- [ ] 为积分结算、权限校验、限流、幂等补充测试
- [ ] 新增 lint、typecheck 脚本
- [ ] 新增 CI/CD 配置（GitHub Actions）
- [ ] 接入 Swagger/OpenAPI 文档
- [ ] 统一错误码规范（数字或字符串）

### 安全加固（必须）

- [ ] GET /emergency/requests/:id 对未登录用户隐藏 contactPhone
- [ ] GET /time-bank/services/:id 增加鉴权
- [ ] 补充限流覆盖（refresh-token、transfer、false-reports、messages）
- [ ] 用户输入字段 XSS 过滤
- [ ] images URL 校验（HTTPS + 域名白名单）
- [ ] 健康证/过敏原强制校验

### AI 能力补齐（参赛必须）

- [ ] 接入大模型 API 实现智能匹配
- [ ] 实现需求分类模型
- [ ] 实现安全风控系统
- [ ] 应急分级改用 AI 模型
- [ ] 实现应急附近响应推送
- [ ] 实现时间银行服务匹配

---

## 附录：实现良好的部分

为客观呈现，以下方面实现较好：

1. **订单状态机并发安全**：技能/厨房/时间银行订单的完成操作普遍使用 `transaction` + `FOR UPDATE` 行锁（`skill-order.service.ts`、`kitchen-order.service.ts`、`time-bank.service.ts`）
2. **幂等性控制设计**：`idempotency.ts` 设计合理，关键写操作均有防重复提交保护（虽需 Redis 化）
3. **列表查询避免 N+1**：普遍使用 JOIN 一次性获取关联信息（除 `getRequestById` 的循环超时检查）
4. **错误处理中间件**：`errorHandler.ts` 区分业务错误与系统错误，设计完整
5. **定时任务独立 try/catch**：`scheduler.ts` 单任务失败不影响其他任务
6. **数据库迁移有审计修复**：`003_fix_audit_issues.sql` 体现迭代改进
7. **环境变量强制校验**：`env.ts` 对 JWT_SECRET 和 DB_PASSWORD 缺失即退出
8. **软删除机制**：核心表有 `deleted_at` 字段
9. **参数化查询**：绝大多数 SQL 使用参数化查询，仅 `updateService` 一处有注入风险
10. **helmet 安全头**：`index.ts` 已启用 helmet

---

> **报告结束**
> 本报告基于 2026-06-17 代码状态生成，所有问题均基于实际代码读取，引用具体行号。建议按"上线前检查清单"顺序逐项修复，优先处理资金安全与数据合规问题。
