# 邻里圈自动迭代进度 — 2026-07-12

## 历史脉络
- 2026-07-09 11:30 调度：Phase 1 收尾 2 项 P0 任务（应急资源地图页、CD 流水线）全部落地验收通过
- 2026-07-09 13:51 调度：Phase 2 全部 8 项 P1 落地，自动切换至 Phase 3 队列
- 2026-07-09 17:25 调度：Phase 3 技术债清理，前端 any 收紧完结
- 2026-07-10 00:30 调度：修复 ForgotPassword 超时 + 补全 ResetPassword + 入库 Auth 玻璃态源码
- 2026-07-10 续作调度：补全测试缺口，前端测试 995 → 1180
- 2026-07-11 调度：后端测试目录 no-explicit-any 警告清零 + Phase 3 技术债清理 5 单元
- 2026-07-11 续作调度：service 层 SQL 审计 + 3 个生产阻塞 BUG 修复 + 日志分级合理化
- 2026-07-11 续作调度：CD 流水线修复 6 单元（GHCR_OWNER 回退值 + docker-compose 填充 + 测试门禁 + 备份持久化 + 路由安全 + Nginx 硬性约束）
- 2026-07-12 续作调度：P0 simpleResetPassword 任意账号密码重置漏洞修复 + P2 bcrypt 异步化 + P2 admin.service 模板插值清理（3 单元）

## 阶段判定
- Phase 1/Phase 2 均已完成（与上轮记录一致，无需重复开发）
- 当前阶段：Phase 3 技术债清理 + 安全加固
- 本轮聚焦：SQL 注入面收窄 + 事务一致性加固 + 前端 XSS/竞态/异常处理 + WebSocket 资源泄漏

---

## 本轮迭代摘要（2026-07-12 — 安全加固 + 技术债清理 7 单元）
- 健康度预检：后端 tsc ✅（零错误）| 后端 vitest 73 文件 1445/1445 ✅ | 前端 build ✅
- 本轮完成 7 个最小迭代单元，7 次 git 提交均 push 到 origin/main：
  - `21a597e refactor: 应急举报处罚 INTERVAL 参数化消除 SQL 字符串拼接`
  - `9a28dc4 fix: 修复前端XSS漏洞与异常处理缺失问题`
  - `e6157cb fix: 修复后端命令注入、事务一致性与WebSocket资源泄漏`
  - `8a5ebd4 test: 适配 unbindFamilyBinding 事务重构的 mock 注入`
  - `373f4cd feat: 前端样式优化（Auth背景图一致性+模块色应用+Admin抽屉动画）与配套文档`
  - `4d56b36 fix: metrics granularity 非法值校验缺失导致 500 错误`
  - `d92261e fix: 前端 setTimeout 未清理导致组件卸载后 setState 资源泄漏`

### 最小迭代单元 1：应急举报处罚 INTERVAL 参数化
- 提交：`21a597e`（已 push）
- 问题根因：emergency.service.ts 中 `INTERVAL '${penaltyConfig.banInterval}'` 使用字符串拼接构造 SQL。虽 banInterval 来自硬编码常量无注入风险，但拼接风格不符合参数化 SQL 规范，易扩散到其他存在用户输入的场景
- 修复方案：改为 `NOW() + $2::interval` 参数化占位符，参数列表 `[status, interval, userId]`
- 修改文件：
  - [server/src/services/emergency.service.ts](file:///e:/work/auto-community/server/src/services/emergency.service.ts)
  - [server/src/services/__tests__/emergency.service.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/emergency.service.test.ts)（SQL 断言对齐 `$2::interval` 占位符）

### 最小迭代单元 2：前端 XSS 漏洞与异常处理缺失修复
- 提交：`9a28dc4`（已 push）
- 问题根因（4 类前端缺陷）：
  1. XSS：ResourceMap 地图标记 infoWindow 直接拼接用户输入 HTML，存在存储型 XSS 风险
  2. 竞态条件：Chat 消息加载未处理组件卸载场景，异步回调可能 setState 已卸载组件
  3. 异常处理缺失：Emergency/Home/Layout/AIRecommend/ServiceDetail 多处异步操作无 try-catch，错误未提示用户
  4. 资源泄漏：LocationPicker 异步定位未添加 cancelled 标志，卸载后仍 setState
- 修复方案：
  - 新增 `escapeHtml` 函数到 format.ts，地图标记内容统一转义
  - Chat/LocationPicker 添加 cancelled 标志，异步回调前检查
  - 5 个页面补全 try-catch 并通过 toast 提示错误
- 修改文件：9 个前端文件（AIRecommend/Layout/LocationPicker/ResourceMap/Emergency/Home/Chat/ServiceDetail/format.ts）

### 最小迭代单元 3：后端命令注入 + 事务一致性 + WebSocket 资源泄漏
- 提交：`e6157cb`（已 push）
- 问题根因（3 类后端缺陷）：
  1. 命令注入：backup.service.ts 将 PGPASSWORD 拼接进命令字符串，虽通过 envVars 传递更安全，但拼接风格存在风险面
  2. 事务一致性：time-bank.service.ts 中 family binding 4 方法（create/confirm/reject/unbind）采用"先查后写"未用事务+行锁，存在并发竞态；createReview 已用事务但缺 FOR UPDATE 行锁
  3. 资源泄漏：WebSocket pubSub 连接未在优雅关闭中释放，进程退出时连接泄漏
- 修复方案：
  - backup.service：PGPASSWORD 仅通过 envVars 传递，移除命令字符串拼接
  - time-bank family binding 4 方法：全部包裹 `transaction(async (client) => {...})`，SELECT 改为 `FOR UPDATE`，通知逻辑事务外 fire-and-forget
  - createReview：事务内 SELECT 订单与已评价记录均加 `FOR UPDATE`
  - WebSocket：新增 `closeWebSocket` 函数，在优雅关闭流程中调用
- 修改文件：
  - [server/src/services/backup.service.ts](file:///e:/work/auto-community/server/src/services/backup.service.ts)
  - [server/src/services/time-bank.service.ts](file:///e:/work/auto-community/server/src/services/time-bank.service.ts)
  - [server/src/services/__tests__/time-bank.service.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/time-bank.service.test.ts)（createReview 测试 mock 适配）
  - [server/src/websocket/index.ts](file:///e:/work/auto-community/server/src/websocket/index.ts)
  - [server/src/index.ts](file:///e:/work/auto-community/server/src/index.ts)

### 最小迭代单元 4：unbindFamilyBinding 测试 mock 适配
- 提交：`8a5ebd4`（已 push）
- 问题根因：单元 3 中 `unbindFamilyBinding` 已重构为事务模式，但其专属测试文件 `time-bank.family-unbind.test.ts` 未同步适配（仍 mock `query` 而非 `transaction` + `mockClient.query`），导致 mock 状态泄漏、createReview 测试块连带失败
- 修复方案：
  - `vi.hoisted` 新增 `mockTransaction` 与 `mockClient`
  - `vi.mock` 中 `transaction: vi.fn()` 改为 `transaction: mockTransaction`
  - `beforeEach` 添加 `mockTransaction.mockImplementation` 注入 mockClient
  - `setupBindingMock` 中 `mockQuery.mockImplementation` 切换为 `mockClient.query.mockImplementation`
  - 断言中 `mockQuery.mock.calls` 切换为 `mockClient.query.mock.calls`
- 修改文件：[server/src/services/__tests__/time-bank.family-unbind.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/time-bank.family-unbind.test.ts)

### 最小迭代单元 5：前端样式优化与配套文档
- 提交：`373f4cd`（已 push）
- 内容：Auth 页面背景图一致性（Register/ForgotPassword/ResetPassword 补齐与 Login 同款背景图）、模块色应用（SkillExchange 蓝/SharedKitchen 橙/TimeBank 紫眉题+快捷入口配色对齐）、Admin 移动端抽屉滑入动画+激活态色条、index.css 新增 slideInLeft 关键帧
- 配套文档：bug-check-2026-07-12.md（15 个已修复+3 个未修复问题记录）、style-opt-2026-07-12.md（样式优化前后对比说明）
- 修改文件：8 个前端文件 + 2 个 docs 文档

### 最小迭代单元 6：metrics granularity 非法值校验缺失修复
- 提交：`4d56b36`（已 push）
- 问题根因：route 层 `granularity as 'day' | 'week' | 'month'` 强制断言绕过 TS 类型检查，service 层 `dateTruncMap[granularity]` 对未映射值返回 `undefined`，SQL 生成 `DATE_TRUNC('undefined', ...)` 触发 500 错误
- 修复方案：双层校验——route 层白名单校验移除 `as` 断言，service 层 defense-in-depth 兜底回退 `'day'`
- 修改文件：
  - [server/src/services/metrics-collector.service.ts](file:///e:/work/auto-community/server/src/services/metrics-collector.service.ts)（参数类型放宽为 string + 内部校验）
  - [server/src/routes/metrics.ts](file:///e:/work/auto-community/server/src/routes/metrics.ts)（白名单校验替代 as 断言）
  - [server/src/services/__tests__/metrics-collector.service.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/metrics-collector.service.test.ts)（+1 非法 granularity 回退测试用例）

### 最小迭代单元 7：前端 setTimeout 未清理资源泄漏修复
- 提交：`d92261e`（已 push）
- 问题根因：HomepageImage/ForgotPassword/ResetPassword 3 个组件中 `setTimeout` 未存储 timer ID，组件卸载时无法清理，异步回调可能对已卸载组件 setState 导致 React 警告与潜在内存泄漏
- 修复方案：`useRef<ReturnType<typeof setTimeout>>` 存储 timer ID + `useEffect` cleanup 卸载时 `clearTimeout`
- 修改文件：
  - [client/src/pages/Admin/HomepageImage.tsx](file:///e:/work/auto-community/client/src/pages/Admin/HomepageImage.tsx)
  - [client/src/pages/Auth/ForgotPassword.tsx](file:///e:/work/auto-community/client/src/pages/Auth/ForgotPassword.tsx)
  - [client/src/pages/Auth/ResetPassword.tsx](file:///e:/work/auto-community/client/src/pages/Auth/ResetPassword.tsx)

## 验证结果（最终）
- 后端 `npx tsc --noEmit` ✅（零错误）
- 后端 `npx vitest run` ✅（73 文件 1446/1446 通过，较上轮 +1 测试用例）
- 前端 `npm run build` ✅（7.76s 零错误零警告）
- time-bank 专项测试 ✅（61 + 8 = 69 用例全绿）
- 前端 Auth/Admin 专项测试 ✅（31 用例全绿）

## 遗留问题
- 高德地图 Key 实际未配置（AMAP_KEY 为空），生产部署后地图页运行在降级模式（静态点位 + 列表）
- CD 流水线依赖 GitHub Secrets 与远程服务器 GHCR 登录态，需运维侧确认
- 迁移文件时间戳冲突（012 和 018 各有 2 个文件共享同一时间戳），不影响功能但不规范，暂不处理
- ~~P0 未修复：`simpleResetPassword` 任意用户密码重置漏洞~~ → 已于 2026-07-12 续作修复（提交 d924820）
- P1 未修复：SkillExchange/Detail.tsx 双重断言 `as unknown as SkillPostRaw`（涉及 api 层多文件改动，风险较高）
- P1 未修复：Chat.tsx WebSocket onStatusChange 闭包陷阱（风险较低，修改可能影响重连逻辑）
- P2 未修复：LocationPicker/Emergency 高德 SDK script 标签未清理（动态加载的 script 在组件卸载时未移除）
- ~~P2 未修复：admin.service.ts 3 处模板插值~~ → 已于 2026-07-12 续作清理 getModuleActivity（提交 8ac1e90），剩余 EXPORT_MAX_ROWS 4 处 LIMIT 模板插值（硬编码常量，无注入风险，涉及参数索引管理，留作后续）
- ~~P2 未修复：auth.service.ts 4 处 bcrypt 同步哈希阻塞事件循环~~ → 已于 2026-07-12 续作修复（提交 65f0755），3 处改为异步 hash/compare

## 下一轮迭代建议
按规范优先级排序：
1. PostgreSQL 慢查询优化：对 P2 级低频查询补充索引（如 audit_logs 多条件动态过滤、time_transactions 按类型查询等）
2. 前端 `Record<string, any>` 收紧（如有剩余，参照后端清理模式）
3. P2 技术债继续清理：admin.service EXPORT_MAX_ROWS 模板插值参数化、LocationPicker 高德 SDK script 标签卸载清理
4. 生产就绪最终复检（7 项验收标准全部达标后可判定生产就绪）

---

## 本轮迭代摘要（2026-07-12 续作 — P0 漏洞修复 + 技术债清理 3 单元）
- 健康度预检：后端 tsc ✅（零错误）| 后端 vitest 73 文件 1446/1446 ✅ | 前端 build ✅（7.74s）
- 本轮完成 3 个最小迭代单元，3 次 git 提交均 push 到 origin/main：
  - `d924820 fix: 修复 simpleResetPassword 任意账号密码重置漏洞，强制使用验证码两步重置流程`
  - `65f0755 refactor: auth.service bcrypt 同步哈希改异步，避免阻塞事件循环`
  - `8ac1e90 refactor: admin.service getModuleActivity 消除 SQL 模板插值`

### 最小迭代单元 1：P0 simpleResetPassword 任意账号密码重置漏洞修复
- 提交：`d924820`（已 push）
- 问题根因：`/auth/simple-reset-password` 端点仅凭注册手机号即可重置密码，存在任意账号接管风险。虽然后端已实现完整的 forgotPassword（生成验证码 + Redis 缓存 + 日志打印）+ resetPassword（校验验证码）两步流程，但前端 ForgotPassword.tsx 直接调用 simpleResetPassword 绕过了验证码校验
- 修复方案：
  - 后端：删除 `simpleResetPassword` 服务方法、`/auth/simple-reset-password` 路由、`SimpleResetPasswordBody` 类型、相关 OpenAPI 文档
  - 前端：ForgotPassword.tsx 重构为发送验证码流程（仅输入手机号 → 调用 forgotPassword → 成功后跳转 `/reset-password?phone=xxx` 完成验证码校验与新密码设置）
  - 客户端 API：删除 `simpleResetPassword` 与 `SimpleResetPasswordParams`
  - 测试同步更新：删除后端 service/route 7 个测试用例，重写前端 ForgotPassword 7 个测试用例匹配新流程
- 修改文件：7 个
  - [server/src/services/auth.service.ts](file:///e:/work/auto-community/server/src/services/auth.service.ts)
  - [server/src/routes/auth.ts](file:///e:/work/auto-community/server/src/routes/auth.ts)
  - [server/src/services/__tests__/auth.service.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/auth.service.test.ts)
  - [server/src/routes/__tests__/auth.test.ts](file:///e:/work/auto-community/server/src/routes/__tests__/auth.test.ts)
  - [client/src/api/auth.ts](file:///e:/work/auto-community/client/src/api/auth.ts)
  - [client/src/pages/Auth/ForgotPassword.tsx](file:///e:/work/auto-community/client/src/pages/Auth/ForgotPassword.tsx)
  - [client/src/pages/Auth/__tests__/ForgotPassword.test.tsx](file:///e:/work/auto-community/client/src/pages/Auth/__tests__/ForgotPassword.test.tsx)

### 最小迭代单元 2：P2 auth.service bcrypt 同步哈希改异步
- 提交：`65f0755`（已 push）
- 问题根因：register/login/resetPassword 3 处使用 `bcrypt.hashSync`/`bcrypt.compareSync`，cost=10 同步哈希约 100ms 会阻塞 Node 事件循环，影响高并发吞吐量
- 修复方案：改为异步 `bcrypt.hash`/`bcrypt.compare`（返回 Promise），函数已是 async，改动极小。测试 mock 同步适配：`mockReturnValue` → `mockResolvedValue`，mock 变量重命名 `mockBcryptHashSync` → `mockBcryptHash`、`mockBcryptCompareSync` → `mockBcryptCompare`
- 修改文件：2 个
  - [server/src/services/auth.service.ts](file:///e:/work/auto-community/server/src/services/auth.service.ts)
  - [server/src/services/__tests__/auth.service.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/auth.service.test.ts)

### 最小迭代单元 3：P2 admin.service getModuleActivity 模板插值清理
- 提交：`8ac1e90`（已 push）
- 问题根因：`getModuleActivity` 中 `const since = "NOW() - INTERVAL '30 days'";` + `${since}` 拼接到 7 个 SQL 查询中。虽 since 为硬编码常量无注入风险，但模板插值风格不符合参数化 SQL 规范，易扩散到存在用户输入的场景
- 修复方案：移除 since 变量，7 个 SQL 中 `${since}` 直接内联为 `NOW() - INTERVAL '30 days'` 字面量。保留数据库服务器时间 NOW() 避免应用服务器时钟漂移。测试断言 `toContain("INTERVAL '30 days'")` 仍然成立
- 修改文件：1 个
  - [server/src/services/admin.service.ts](file:///e:/work/auto-community/server/src/services/admin.service.ts)

## 验证结果（最终）
- 后端 `npx tsc --noEmit` ✅（零错误）
- 后端 `npx vitest run` ✅（73 文件 1439/1439 通过，较上轮 -7：删除 simpleResetPassword 4 个 service 测试 + 3 个 route 测试）
- 前端 `npm run build` ✅（7.95s 零错误零警告）
- 前端 ForgotPassword 专项测试 ✅（7 用例全绿，匹配新发送验证码流程）
- 后端 auth 专项测试 ✅（service 28 + route 19 = 47 用例全绿）

## 本次迭代摘要（2026-07-12 01:00）
- 完成任务：P0 simpleResetPassword 漏洞修复 + P2 bcrypt 异步化 + P2 admin 模板插值清理
- 修改文件：auth.service.ts, routes/auth.ts, auth.service.test.ts, auth.test.ts, client/api/auth.ts, ForgotPassword.tsx, ForgotPassword.test.tsx, admin.service.ts（共 8 个文件，3 次提交）
- 验证结果：类型检查 ✅ | 测试 ✅（1439/1439）| 构建 ✅
- 遗留问题：高德 Key 未配置（降级模式运行）；CD 流水线依赖运维侧 Secrets 配置；EXPORT_MAX_ROWS 4 处 LIMIT 模板插值待参数化；SkillExchange 双重断言、Chat WebSocket 闭包陷阱、LocationPicker script 标签未清理
- 下一轮建议：PostgreSQL 慢查询索引优化 + admin.service EXPORT_MAX_ROWS 参数化 + 前端 any 收紧

---

## 本轮迭代摘要（2026-07-12 续作 2 — 慢查询索引优化 + SQL 参数化 + 前端类型安全 5 单元）
- 健康度预检：后端 tsc ✅（零错误）| 后端 vitest 73 文件 1439/1439 ✅ | 前端 build ✅（7.95s）
- 本轮完成 5 个最小迭代单元，5 次 git 提交均 push 到 origin/main：
  - `68ea374 feat: 补建 P7 性能索引覆盖慢查询风险点`
  - `742b178 refactor: admin.service 导出 LIMIT 参数化消除 SQL 模板插值`
  - `a1fc1e4 fix: 高德 SDK script 标签组件卸载时未清理导致 DOM 堆积`
  - `a701352 refactor: caseConverter 采用函数重载消除 as unknown as 双重断言`
  - `08ef039 refactor: upload.ts 修正 axios 泛型用法消除双重断言`

### 最小迭代单元 1：P7 性能索引补建
- 提交：`68ea374`（已 push）
- 问题根因：审计 service 层 SQL 查询模式与现有索引覆盖情况，识别 3 个慢查询风险点：
  1. audit_logs 多条件动态过滤 status 维度缺失索引（audit.service getAuditLogs + admin.service 导出审计日志）
  2. time_transactions fetchDailyEarned 四字段组合查询未覆盖（time-bank.service createOrder/completeOrder 高频调用）
  3. credit_transactions getTimeHistory 三字段组合查询未覆盖（user.service 积分明细页）
- 修复方案：新建 P7 迁移文件补建 3 个复合索引：
  - `idx_audit_logs_status_created` ON audit_logs(status, created_at DESC)
  - `idx_time_transactions_to_user_type_status_created` ON time_transactions(to_user_id, type, status, created_at)
  - `idx_credit_transactions_user_type_created` ON credit_transactions(user_id, type, created_at DESC)
- 修改文件：
  - [database/migrations/027_performance_indexes_p7.sql](file:///e:/work/auto-community/database/migrations/027_performance_indexes_p7.sql)（新建）
  - [server/src/migrations/1704067200029_performance_indexes_p7.ts](file:///e:/work/auto-community/server/src/migrations/1704067200029_performance_indexes_p7.ts)（新建）

### 最小迭代单元 2：admin.service EXPORT_MAX_ROWS LIMIT 参数化
- 提交：`742b178`（已 push）
- 问题根因：admin.service.ts 中 4 处 `LIMIT ${EXPORT_MAX_ROWS}` 使用模板插值。虽 EXPORT_MAX_ROWS 为硬编码常量无注入风险，但模板插值风格不符合参数化 SQL 规范，易扩散到存在用户输入的场景
- 修复方案：4 处 `LIMIT ${EXPORT_MAX_ROWS}` 改为 `LIMIT $${paramIndex}` 参数化占位符，EXPORT_MAX_ROWS 作为参数添加到 params 数组末尾。测试断言同步更新（3 处 params toEqual + 1 处 LIMIT 正则）
- 修改文件：
  - [server/src/services/admin.service.ts](file:///e:/work/auto-community/server/src/services/admin.service.ts)
  - [server/src/services/__tests__/admin.export.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/admin.export.test.ts)

### 最小迭代单元 3：高德 SDK script 标签卸载清理
- 提交：`a1fc1e4`（已 push）
- 问题根因：LocationPicker 与 ResourceMap 动态加载的高德 SDK script 标签在组件卸载时未移除，多次进出页面会导致 DOM 标签堆积
- 修复方案：
  - 为 script 添加统一 id（`amap-sdk-script`），useEffect cleanup 中通过 getElementById 精确移除
  - 添加 cancelled 标志防止卸载后 setState
  - window.AMap 不移除，SDK 加载后持久缓存复用
- 修改文件：
  - [client/src/components/Map/LocationPicker.tsx](file:///e:/work/auto-community/client/src/components/Map/LocationPicker.tsx)
  - [client/src/pages/Emergency/ResourceMap.tsx](file:///e:/work/auto-community/client/src/pages/Emergency/ResourceMap.tsx)

### 最小迭代单元 4：caseConverter 函数重载消除双重断言
- 提交：`a701352`（已 push）
- 问题根因：`convertKeys<T>` 泛型工具函数内部 2 处 `as unknown as T` 双重断言，将 `Record<string,unknown>` / `unknown[]` 强转为泛型 T
- 修复方案：采用函数重载——公开签名保留 `T → T`（调用方看到的类型不变），实现签名用 `unknown` 内部处理（无需双重断言）。对外 API 完全兼容，运行时行为不变
- 修改文件：[client/src/api/caseConverter.ts](file:///e:/work/auto-community/client/src/api/caseConverter.ts)

### 最小迭代单元 5：upload.ts axios 泛型修正
- 提交：`08ef039`（已 push）
- 问题根因：`client.post<UploadResult>` 误用导致 response 被推断为 `AxiosResponse<UploadResult>`，不得不 `as unknown as UploadResult` 双重断言。根因是 axios 拦截器 `return response.data` 后实际返回 `T` 而非 `AxiosResponse<T>`，但泛型参数未正确指定
- 修复方案：改为与其他 api 文件统一的 `client.post<never, UploadResult>` 写法，响应拦截器返回 response.data 的类型正确推导为 UploadResult，消除 2 处双重断言。运行时行为不变
- 修改文件：[client/src/api/upload.ts](file:///e:/work/auto-community/client/src/api/upload.ts)

## 验证结果（最终）
- 后端 `npx tsc --noEmit` ✅（零错误）
- 后端 `npx vitest run` ✅（73 文件 1439/1439 通过）
- 前端 `npm run build` ✅（7.92s 零错误零警告）
- admin.export 专项测试 ✅（16 用例全绿）
- LocationPicker + ResourceMap 专项测试 ✅（26 用例全绿）
- caseConverter 专项测试 ✅（21 用例全绿）
- ImageUpload 专项测试 ✅（11 用例全绿）

## 遗留问题
- 高德地图 Key 实际未配置（AMAP_KEY 为空），生产部署后地图页运行在降级模式（静态点位 + 列表）
- CD 流水线依赖 GitHub Secrets 与远程服务器 GHCR 登录态，需运维侧确认
- 迁移文件时间戳冲突（012 和 018 各有 2 个文件共享同一时间戳），不影响功能但不规范，暂不处理
- P1 未修复：SkillExchange/Detail.tsx 双重断言 `as unknown as SkillPostRaw`（涉及 SkillPostRaw 类型在 3 处重复定义，需跨文件统一类型后消除 4 处双重断言，风险中等）
- P1 未修复：Chat.tsx WebSocket onStatusChange 闭包陷阱（风险较低，修改可能影响重连逻辑）

## 下一轮迭代建议
按规范优先级排序：
1. ~~SkillPostRaw 类型统一：消除 Detail.tsx/index.tsx/mockInterceptor.ts 中 4 处双重断言~~ → 已于 2026-07-12 续作 3 完成（提交 d2a68d0）
2. 生产就绪最终复检（7 项验收标准全部达标后可判定生产就绪）
3. 其他低频技术债清理（如日志分级复查、迁移文件时间戳规范化等）

---

## 本轮迭代摘要（2026-07-12 续作 3 — SkillPost 类型统一 + Chat 重连计数修复 + 生产就绪复检 3 单元）
- 健康度预检：后端 tsc ✅（零错误）| 后端 vitest 73 文件 1439/1439 ✅ | 前端 build ✅（8.07s）
- 本轮完成 2 个最小迭代单元 + 1 项生产就绪复检，2 次 git 提交均 push 到 origin/main：
  - `d2a68d0 refactor: SkillPost 类型字段名统一 creditsRequired → creditPrice，消除双重断言`
  - `9af22a1 fix: Chat 重连计数显示与 websocket.ts 内部日志对齐，+1 修正首次重连显示第0次`

### 最小迭代单元 1：SkillPost 类型字段名统一 creditsRequired → creditPrice
- 提交：`d2a68d0`（已 push）
- 问题根因：前端 `SkillPost.creditsRequired` 与后端实际返回 `creditPrice` 字段名不一致，导致 Detail.tsx/index.tsx 需 `SkillPostRaw` + `as unknown as` 双重断言绕过类型检查。SkillPostRaw 在 3 处重复定义（mockData.ts/Detail.tsx/index.tsx），双重断言 4 处
- 附带发现：CreatePostParams 发送 `creditsRequired` → 拦截器转为 `credits_required` → 后端 DTO 期望 `credit_price`，字段不匹配导致创建帖子积分丢失（隐藏 BUG）
- 修复方案：将 SkillPost/CreatePostParams 的 `creditsRequired` 统一改为 `creditPrice`，与后端 toSkillPost 返回字段对齐。改为 `creditPrice` 后拦截器自动转为 `credit_price`，同时修复创建帖子积分丢失 BUG
- 分析要点：AdminContentItem.creditsRequired 不修改——后端 admin 接口 CONTENT_CONFIG.skill.alias = 'creditsRequired'，字段名一致
- 修改文件（9 个）：
  - [client/src/types/index.ts](file:///e:/work/auto-community/client/src/types/index.ts)（SkillPost.creditsRequired → creditPrice）
  - [client/src/api/skills.ts](file:///e:/work/auto-community/client/src/api/skills.ts)（CreatePostParams.creditsRequired → creditPrice）
  - [client/src/pages/SkillExchange/Create.tsx](file:///e:/work/auto-community/client/src/pages/SkillExchange/Create.tsx)（提交字段名）
  - [client/src/utils/mockData.ts](file:///e:/work/auto-community/client/src/utils/mockData.ts)（移除 SkillPostRaw 定义，mockSkillPosts 改为 SkillPost[]）
  - [client/src/utils/mockInterceptor.ts](file:///e:/work/auto-community/client/src/utils/mockInterceptor.ts)（移除双重断言）
  - [client/src/pages/SkillExchange/Detail.tsx](file:///e:/work/auto-community/client/src/pages/SkillExchange/Detail.tsx)（移除 SkillPostRaw 和双重断言）
  - [client/src/pages/SkillExchange/index.tsx](file:///e:/work/auto-community/client/src/pages/SkillExchange/index.tsx)（移除 SkillPostRaw 和双重断言）
  - [client/src/pages/SkillExchange/__tests__/Create.test.tsx](file:///e:/work/auto-community/client/src/pages/SkillExchange/__tests__/Create.test.tsx)（断言字段名）
  - [client/src/pages/SkillExchange/__tests__/Detail.test.tsx](file:///e:/work/auto-community/client/src/pages/SkillExchange/__tests__/Detail.test.tsx)（注释更新）

### 最小迭代单元 2：Chat 重连计数显示与 websocket.ts 内部日志对齐
- 提交：`9af22a1`（已 push）
- 问题根因：Chat.tsx `setReconnectCount(wsClient.getReconnectAttempts())` 获取递增前的值（reconnectAttempts 在 setTimeout 回调中递增，onStatusChange 在递增前触发），首次重连显示"第 0 次"，而 websocket.ts 内部日志用 `reconnectAttempts + 1` 显示"第 1 次"，两者不一致
- 闭包陷阱分析结论：经详细审查，onStatusChange 回调**不存在闭包陷阱**——wsClient 是 useEffect 内局部变量（不会被重新赋值），getReconnectAttempts 是实例方法读取当前状态，wasReconnecting 是共享变量引用。bug-check 中的描述是对代码风格的过度担忧，已在注释中说明分析结论
- 修复方案：`setReconnectCount(wsClient.getReconnectAttempts() + 1)`，与 websocket.ts 内部日志计数方式一致
- 修改文件（2 个）：
  - [client/src/pages/Messages/Chat.tsx](file:///e:/work/auto-community/client/src/pages/Messages/Chat.tsx)（+1 修正 + 闭包分析注释）
  - [client/src/pages/Messages/__tests__/Chat.test.tsx](file:///e:/work/auto-community/client/src/pages/Messages/__tests__/Chat.test.tsx)（断言"第 3 次"对齐 +1）

### 生产就绪复检（规范第九章 7 项验收标准）
1. ✅ Phase1/Phase2 所有核心业务功能开发完成，全业务链路闭环完整
2. ✅ 后端 TypeScript 类型检查零错误、零警告（tsc --noEmit exit 0）
3. ✅ 后端单元测试覆盖率 95.39%（远超 70% 标准），全量 1439/1439 通过
4. ✅ 前端生产构建零错误、零警告（8.07s，最大 chunk 246.40 kB gzip 83.10 kB）
5. ⚠️ 全页面移动端适配、交互体验、状态提示完整统一（已做多轮精修，需人工最终复查）
6. ⚠️ CI/CD 流水线完整闭环（已搭建，依赖 GitHub Secrets 与远程服务器 GHCR 登录态，需运维确认）
7. ✅ 无高危技术债、数据库事务/索引/并发机制完善（多轮安全加固已完成）

### 技术债排查结论
- 前端 any 类型：非测试文件已清零 ✅
- 前端 eslint：零警告 ✅
- 后端 console.log：非测试代码无残留 ✅
- TODO/FIXME 注释：全项目无残留 ✅
- ImageUpload 闭包陷阱：经分析不存在（useCallback 依赖数组完整 + 函数式更新）✅

## 验证结果（最终）
- 后端 `npx tsc --noEmit` ✅（零错误）
- 后端 `npx vitest run --coverage` ✅（73 文件 1439/1439 通过，覆盖率 95.39%）
- 前端 `npx tsc --noEmit` ✅（零错误）
- 前端 `npm run build` ✅（8.07s 零错误零警告）
- 前端 `npx eslint src --ext .ts,.tsx` ✅（零警告）
- 前端全量测试 ✅（79 文件 1178/1178 通过）
- SkillExchange 专项测试 ✅（6 文件 114/114 通过）
- Chat 专项测试 ✅（18 用例全绿）

## 遗留问题
- 高德地图 Key 实际未配置（AMAP_KEY 为空），生产部署后地图页运行在降级模式（静态点位 + 列表）
- CD 流水线依赖 GitHub Secrets 与远程服务器 GHCR 登录态，需运维侧确认
- 迁移文件时间戳冲突（012 和 018 各有 2 个文件共享同一时间戳），不影响功能但不规范，修改时间戳有迁移记录不一致风险，暂不处理
- ResourceMap setTimeout 绑定 onclick（与高德地图相关，降级模式下无实际效果，待配置高德 Key 后处理）
- 生产就绪标准第 5 项（全页面移动端适配）需人工最终复查
- 生产就绪标准第 6 项（CI/CD 流水线）需运维确认 Secrets 配置

## 下一轮迭代建议
按规范优先级排序：
1. 生产就绪人工复查：全页面移动端适配、交互体验、状态提示完整性
2. 运维侧确认：CD 流水线 GitHub Secrets 与 GHCR 登录态配置
3. 高德地图 Key 配置后：处理 ResourceMap setTimeout onclick 清理问题
4. 迁移文件时间戳规范化（需评估迁移记录一致性风险）

---

## 本轮迭代摘要（2026-07-12 续作 4 — 安全加固 + 资源泄漏防御 + 用户体验补全 7 单元）
- 健康度预检：后端 tsc ✅（零错误）| 后端 vitest 73 文件 1439/1439 ✅ | 前端 build ✅（8.04s）
- 本轮完成 7 个最小迭代单元（1 个 P0 安全修复 + 4 个 P1 资源泄漏/类型安全 + 2 个 P2 用户体验），代码改动已落地，待用户确认后 git 提交

### 最小迭代单元 1：P0 .env.example 泄露真实生产凭据修复
- 问题根因：`.env.example` 被 git 追踪且包含真实生产数据库 IP（114.116.250.210）、DB/Redis 密码（My-123456）、JWT 签名密钥（真实 hex 密钥），任何能访问仓库的人都能直接连接生产数据库
- 修复方案：将所有敏感值替换为占位符（localhost / your-*-password-here / your-jwt-secret-here），补充"切勿提交真实凭据到仓库"安全提示
- 修改文件：[.env.example](file:///e:/work/auto-community/.env.example)
- 注：历史 commit 中仍含泄露凭据，需运维侧轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史

### 最小迭代单元 2：P1 health.ts 与 metrics.service.ts PoolClient 释放移入 finally 块
- 问题根因：`pool.connect()` 后 `client.release()` 不在 finally 块中，当前虽紧跟 connect 后无风险，但后续维护者在中间插入逻辑时一旦抛异常会导致连接泄漏（连接池 max:20 耗尽将拖垮服务）
- 修复方案：client 在 try 外声明，release 移入 finally 块，使用 `client?.release()` 可选链确保安全
- 修改文件：
  - [server/src/routes/health.ts](file:///e:/work/auto-community/server/src/routes/health.ts)
  - [server/src/services/metrics.service.ts](file:///e:/work/auto-community/server/src/services/metrics.service.ts)

### 最小迭代单元 3：P1 env.ts as string 断言改为类型收窄
- 问题根因：`DB_PASSWORD: process.env.DB_PASSWORD as string` 和 `JWT_SECRET: process.env.JWT_SECRET as string` 使用 as 断言绕过类型安全。虽有前置校验（缺失则 process.exit(1)），但校验在另一作用域，后续重构移动校验代码时 as string 会静默将 undefined 当作 string 传递
- 修复方案：校验后赋值给局部变量（jwtSecret/dbPassword）实现类型收窄（string | undefined → string），后续直接使用局部变量无需 as
- 修改文件：[server/src/config/env.ts](file:///e:/work/auto-community/server/src/config/env.ts)

### 最小迭代单元 4：P1 backup.service.ts 绕过 env.ts 直接读 process.env 修复
- 问题根因：`getBackupConfig()` 中 `process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups')` 绕过了 env.ts 统一配置入口，与 env.ts 中 BACKUP_DIR 默认值逻辑重复，后续 env.ts 调整默认值或增加校验时此处不生效
- 修复方案：改为 `env.BACKUP_DIR`，消除配置入口分裂。测试 mock 同步补充 BACKUP_DIR 字段
- 修改文件：
  - [server/src/services/backup.service.ts](file:///e:/work/auto-community/server/src/services/backup.service.ts)
  - [server/src/services/__tests__/backup.service.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/backup.service.test.ts)（mock env 补充 BACKUP_DIR）

### 最小迭代单元 5：P1 前端 websocket.ts console.error/warn 环境守卫
- 问题根因：`console.log` 已用 `if (import.meta.env.DEV)` 守卫，但 `console.error`（3 处）和 `console.warn`（1 处）未做守卫，生产环境会暴露 WebSocket 内部实现细节到浏览器控制台
- 修复方案：
  - onerror 中的 console.error 移除（onError 回调已由调用方处理，重复输出是噪音）
  - send 失败的 console.warn 添加 DEV 守卫（调用方应通过返回值 false 判断发送失败）
  - 保留 connect 创建失败和消息解析失败的 console.error（真正的系统错误，生产环境需保留排查能力）
- 修改文件：[client/src/utils/websocket.ts](file:///e:/work/auto-community/client/src/utils/websocket.ts)

### 最小迭代单元 6：P2 ai.service.ts JSON.parse 类型断言加固运行时校验
- 问题根因：`JSON.parse(row.embedding) as number[]` 不安全断言，若数据库存储的 JSON 结构异常（被手动修改为对象或字符串数组），cosineSimilarity 内部虽有长度检查但不校验元素类型，可能导致 NaN 传播
- 修复方案：解析后做运行时校验 `Array.isArray(parsed) && parsed.every(v => typeof v === 'number')`，异常数据跳过并 warn 日志，用 type guard filter 消除 null
- 修改文件：[server/src/services/ai.service.ts](file:///e:/work/auto-community/server/src/services/ai.service.ts)

### 最小迭代单元 7：P2 前端多个 catch 块补充 Toast 用户反馈
- 问题根因：6 个页面 10 处 catch 块仅 `console.error` 不向用户反馈，用户看到空白页面或"加载中"永远不消失，无法判断是网络问题还是无数据
- 修复方案：在用户主动操作或影响主要功能的 catch 块中添加 `toast.error()` 提示。跳过 Chat 拉取离线消息失败（重连后补齐，不影响主功能）、Home 首页统计/图片加载失败（有默认值）、Layout 未读消息数加载失败（导航栏小红点不显示）等后台静默请求
- 修改文件（6 个）：
  - [client/src/pages/Notifications/index.tsx](file:///e:/work/auto-community/client/src/pages/Notifications/index.tsx)（3 处：加载通知/标记已读/全部标记已读）
  - [client/src/pages/SharedKitchen/index.tsx](file:///e:/work/auto-community/client/src/pages/SharedKitchen/index.tsx)（2 处：美食分享/拼单列表）
  - [client/src/pages/SharedKitchen/Orders.tsx](file:///e:/work/auto-community/client/src/pages/SharedKitchen/Orders.tsx)（1 处：订单列表）
  - [client/src/pages/SharedKitchen/GroupOrders.tsx](file:///e:/work/auto-community/client/src/pages/SharedKitchen/GroupOrders.tsx)（1 处：拼单列表）
  - [client/src/pages/SkillExchange/index.tsx](file:///e:/work/auto-community/client/src/pages/SkillExchange/index.tsx)（1 处：技能列表）
  - [client/src/pages/Admin/Metrics.tsx](file:///e:/work/auto-community/client/src/pages/Admin/Metrics.tsx)（2 处：仪表盘/趋势数据）

## 验证结果（最终）
- 后端 `npx tsc --noEmit` ✅（零错误）
- 后端 `npx vitest run` ✅（73 文件 1439/1439 通过）
- 前端 `npm run build` ✅（8.04s 零错误零警告）
- 前端相关页面测试 ✅（14 文件 240/240 通过，含 Notifications/SharedKitchen/SkillExchange/Admin Metrics）
- backup 专项测试 ✅（13 用例全绿，mock env 补充 BACKUP_DIR）
- health + metrics 专项测试 ✅（20 用例全绿）
- ai.service 专项测试 ✅（60 用例全绿）
- Chat + websocket 专项测试 ✅（47 用例全绿）

## 遗留问题
- 高德地图 Key 实际未配置（AMAP_KEY 为空），生产部署后地图页运行在降级模式（静态点位 + 列表）
- CD 流水线依赖 GitHub Secrets 与远程服务器 GHCR 登录态，需运维侧确认
- 迁移文件时间戳冲突（012 和 018 各有 2 个文件共享同一时间戳），不影响功能但不规范，修改时间戳有迁移记录不一致风险，暂不处理
- ResourceMap setTimeout 绑定 onclick（与高德地图相关，降级模式下无实际效果，待配置高德 Key 后处理）
- 生产就绪标准第 5 项（全页面移动端适配）需人工最终复查
- 生产就绪标准第 6 项（CI/CD 流水线）需运维确认 Secrets 配置
- **P0 安全遗留**：.env.example 历史 commit 中仍含泄露凭据，需运维侧轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史（git filter-repo）或重建仓库
- **审计发现未处理项**：
  - P2 后端大量使用 SELECT *（约 60+ 处，性能优化项，非阻塞）
  - P2 SQL 迁移文件 002_ 前缀冲突（3 个文件共享 002_ 前缀，命名不规范但不影响功能）
  - P3 Layout 未读消息数不实时刷新（需 WebSocket 订阅未读数变更事件）

## 下一轮迭代建议
按规范优先级排序：
1. **运维侧紧急处理**：轮换 DB/Redis 密码与 JWT 密钥，清理 git 历史中的泄露凭据
2. 生产就绪人工复查：全页面移动端适配、交互体验、状态提示完整性
3. 运维侧确认：CD 流水线 GitHub Secrets 与 GHCR 登录态配置
4. 高德地图 Key 配置后：处理 ResourceMap setTimeout onclick 清理问题
5. P2 性能优化：后端 SELECT * 逐步替换为精确列名（按高频表优先）
6. 迁移文件时间戳规范化（需评估迁移记录一致性风险）

## 本次迭代摘要（2026-07-12 02:15）
- 完成任务：P0 .env.example 凭据泄露修复 + P1 PoolClient 释放/类型收窄/配置入口分裂/前端日志守卫 + P2 JSON.parse 校验/前端 Toast 反馈（共 7 单元）
- 修改文件：.env.example, server/src/routes/health.ts, server/src/services/metrics.service.ts, server/src/config/env.ts, server/src/services/backup.service.ts, server/src/services/ai.service.ts, server/src/services/__tests__/backup.service.test.ts, client/src/utils/websocket.ts, client/src/pages/Notifications/index.tsx, client/src/pages/SharedKitchen/index.tsx, client/src/pages/SharedKitchen/Orders.tsx, client/src/pages/SharedKitchen/GroupOrders.tsx, client/src/pages/SkillExchange/index.tsx, client/src/pages/Admin/Metrics.tsx（共 14 个文件）
- 验证结果：类型检查 ✅ | 测试 ✅（1439/1439）| 构建 ✅
- 遗留问题：.env.example 历史 commit 凭据泄露需运维轮换密钥+清理 git 历史；高德 Key 未配置；CD 流水线依赖运维 Secrets；SELECT * 性能优化待推进
- 下一轮建议：运维紧急轮换密钥 + 生产就绪人工复查 + SELECT * 性能优化

---

## 本轮迭代摘要（2026-07-12 续作 5 — 上轮遗留补提交 + SELECT * 替换 + 紧急修复 8 单元）
- 健康度预检：后端 tsc ✅（零错误）| 后端 vitest 73 文件 1439/1439 ✅ | 前端 build ✅（8.40s）
- 本轮完成 8 个最小迭代单元，8 次 git 提交均 push 到 origin/main：
  - 上轮遗留补提交（5 commits）：
    - `3c43c1a fix: .env.example 替换真实生产凭据为占位符`
    - `4b601dc refactor: 后端 PoolClient 释放移入 finally + env 类型收窄 + backup 配置入口统一`
    - `be950ca refactor: 前端 websocket.ts error/warn 日志添加 DEV 环境守卫`
    - `6db590e fix: ai.service.ts JSON.parse 运行时校验加固`
    - `b028fb5 fix: 前端 6 个页面 catch 块补充 toast.error 用户反馈`
  - 本轮新增（3 commits）：
    - `8d74073 refactor: skill-order.service SELECT * 替换为精确列名`
    - `6f2c95a refactor: time-bank.service time_orders SELECT * 替换`
    - `260f18d refactor: time-bank.service family_bindings SELECT * 替换`
  - 紧急修复（1 commit）：
    - `ac30b3b fix: SELECT ${COLUMNS} 单引号改反引号，修复模板插值失效导致 SQL 语法错误`

### 上轮遗留补提交说明
- 上轮（续作 4）7 个单元代码改动已落地但未 git 提交，本轮核实 git 状态后按逻辑单元分 5 组补提交
- 14 个未提交文件对应 7 个单元：.env.example 凭据修复 + 后端 PoolClient/env/backup 健壮性 + 前端日志守卫 + ai.service 校验 + 前端 Toast 反馈

### 最小迭代单元 1：skill-order.service.ts SELECT * 替换
- 提交：`8d74073`（已 push）
- 内容：12 处 `SELECT * FROM skill_orders` 改为 `SKILL_ORDER_COLUMNS` 常量（16 字段，不含 timeout_at）；1 处 `SELECT * FROM skill_posts` 改为仅查 5 个消费字段（有性能收益，避免返回 description TEXT/images TEXT[] 大字段）
- 修改文件：[server/src/services/skill-order.service.ts](file:///e:/work/auto-community/server/src/services/skill-order.service.ts)

### 最小迭代单元 2：time-bank.service.ts time_orders 替换
- 提交：`6f2c95a`（已 push）
- 内容：6 处 `SELECT * FROM time_orders` 改为 `TIME_ORDER_COLUMNS` 常量（11 字段）；同步修改 time-bank.service.test.ts 2 处 mock 匹配字符串（去掉 `SELECT * ` 前缀改为 `FROM` 匹配）
- 修改文件：[server/src/services/time-bank.service.ts](file:///e:/work/auto-community/server/src/services/time-bank.service.ts), [server/src/services/__tests__/time-bank.service.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/time-bank.service.test.ts)

### 最小迭代单元 3：time-bank.service.ts family_bindings 替换
- 提交：`260f18d`（已 push）
- 内容：6 处 `SELECT * FROM family_bindings` 改为 `FAMILY_BINDING_COLUMNS` 常量（7 字段）；同步修改 time-bank.family-unbind.test.ts 1 处 mock 匹配字符串
- 修改文件：[server/src/services/time-bank.service.ts](file:///e:/work/auto-community/server/src/services/time-bank.service.ts), [server/src/services/__tests__/time-bank.family-unbind.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/time-bank.family-unbind.test.ts)

### 紧急修复：单引号模板插值失效 BUG（P0 生产阻塞）
- 提交：`ac30b3b`（已 push）
- 问题根因：前 3 个 SELECT * 替换提交使用 `replace_all` 将 `SELECT * FROM table` 替换为 `SELECT ${COLUMNS} FROM table`，但保留了原始单引号字符串。单引号中 `${...}` 不被模板插值，实际 SQL 为字面量 `SELECT ${COLUMNS} FROM table WHERE id = $1`，触发 PostgreSQL 语法错误。测试 mock 不执行实际 SQL（mockResolvedValueOnce 按顺序返回），未暴露此问题
- 修复方案：24 处单引号字符串改为反引号（模板字符串），`${COLUMNS}` 正确插值，`$1` 保持字面量（`$1` 不是 `${...}` 模式）
- 教训记录：**replace_all 替换字符串内容时不改变引号类型，单引号中 ${...} 不被插值。使用常量插值必须确保字符串使用反引号。测试 mock 不执行实际 SQL，无法发现 SQL 语法错误，替换 SQL 后应人工检查引号类型**
- 修改文件：[server/src/services/skill-order.service.ts](file:///e:/work/auto-community/server/src/services/skill-order.service.ts), [server/src/services/time-bank.service.ts](file:///e:/work/auto-community/server/src/services/time-bank.service.ts)

## 验证结果（最终）
- 后端 `npx tsc --noEmit` ✅（零错误）
- 后端 `npx vitest run` ✅（73 文件 1439/1439 通过）
- 前端 `npm run build` ✅（8.40s 零错误零警告）
- Grep 确认无遗漏的单引号 `'SELECT ${` 模式 ✅

## 遗留问题
- 高德地图 Key 实际未配置（AMAP_KEY 为空），生产部署后地图页运行在降级模式（静态点位 + 列表）
- CD 流水线依赖 GitHub Secrets 与远程服务器 GHCR 登录态，需运维侧确认
- 迁移文件时间戳冲突（012 和 018 各有 2 个文件共享同一时间戳），不影响功能但不规范，修改时间戳有迁移记录不一致风险，暂不处理
- ResourceMap setTimeout 绑定 onclick（与高德地图相关，降级模式下无实际效果，待配置高德 Key 后处理）
- 生产就绪标准第 5 项（全页面移动端适配）需人工最终复查
- 生产就绪标准第 6 项（CI/CD 流水线）需运维确认 Secrets 配置
- **P0 安全遗留**：.env.example 历史 commit 中仍含泄露凭据，需运维侧轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史（git filter-repo）或重建仓库
- **P2 性能优化进行中**：后端 SELECT * 已替换 3 个表（skill_orders/time_orders/family_bindings 共 24 处），剩余约 30 处待替换（time_accounts/time_services/time_transactions/group_orders/kitchen_orders/emergency_requests/emergency_responses/emergency_resources/delivery_addresses/messages/users/credit_transactions/verification_requests 等）
- **类型不一致**：TimeAccountRow 接口包含 created_at 字段，但 time_accounts 表无此字段（SELECT * 返回 undefined），替换时需同步从接口移除

## 下一轮迭代建议
按规范优先级排序：
1. **运维侧紧急处理**：轮换 DB/Redis 密码与 JWT 密钥，清理 git 历史中的泄露凭据
2. 生产就绪人工复查：全页面移动端适配、交互体验、状态提示完整性
3. 运维侧确认：CD 流水线 GitHub Secrets 与 GHCR 登录态配置
4. P2 SELECT * 替换继续推进：优先替换有性能收益的查询（只使用部分字段的 SELECT *），如 kitchen_posts/emergency_resources 等含 TEXT/JSONB 大字段的表
5. 修复 TimeAccountRow 接口 created_at 类型不一致问题
6. 高德地图 Key 配置后：处理 ResourceMap setTimeout onclick 清理问题

## 本次迭代摘要（2026-07-12 02:35）
- 完成任务：上轮遗留 7 单元补提交（5 commits）+ SELECT * 替换 3 表 24 处（3 commits）+ 紧急修复单引号模板插值失效 BUG（1 commit）
- 修改文件：上轮 14 文件 + server/src/services/skill-order.service.ts, server/src/services/time-bank.service.ts, server/src/services/__tests__/time-bank.service.test.ts, server/src/services/__tests__/time-bank.family-unbind.test.ts（共 18 文件，8 次提交）
- 验证结果：类型检查 ✅ | 测试 ✅（1439/1439）| 构建 ✅
- 遗留问题：SELECT * 替换剩约 30 处待推进；TimeAccountRow 类型不一致；.env.example 历史 commit 凭据泄露需运维处理
- 下一轮建议：SELECT * 替换继续推进 + 修复 TimeAccountRow 类型不一致 + 运维紧急轮换密钥

---

## 本轮迭代摘要（2026-07-12 续作 6 — TimeAccountRow 类型修复 + SELECT * 替换推进 5 单元）
- 健康度预检：后端 tsc ✅（零错误）| 后端 vitest 73 文件 1439/1439 ✅ | 前端 build ✅（8.26s）
- 本轮完成 5 个最小迭代单元，5 次 git 提交均 push 到 origin/main：
  - `e207645 refactor: TimeAccountRow 接口移除 created_at 字段与 time_accounts SELECT * 替换`
  - `a2a9079 refactor: kitchen-order.service SELECT * 替换为精确列名`
  - `eda2138 refactor: time-bank.service 剩余 4 处 SELECT * 替换为精确列名`
  - `f7edee9 refactor: emergency-resource.service SELECT * 替换为精确列名`
  - `daa78ce refactor: emergency.service 5 处 SELECT * 替换为精确列名`

### 最小迭代单元 1：TimeAccountRow 接口移除 created_at + time_accounts SELECT * 替换
- 提交：`e207645`（已 push）
- 问题根因：TimeAccountRow 接口声明 `created_at: Date`，但 time_accounts 表无此列（迁移 002 仅 6 字段），SELECT * 返回 undefined，类型与运行时不一致
- 修复方案：
  - 从接口移除 created_at 字段与数据库对齐
  - 新增 TIME_ACCOUNT_COLUMNS 常量替代 getOrCreateAccount 中 2 处 SELECT *（FOR UPDATE 查询 + INSERT RETURNING）
  - 同步适配 3 个测试文件 mock 匹配字符串（time-bank.donate/transfer/service.test.ts 去掉 SELECT * 前缀改为 FROM 匹配）
- 修改文件：
  - [server/src/services/time-bank.service.ts](file:///e:/work/auto-community/server/src/services/time-bank.service.ts)
  - [server/src/services/__tests__/time-bank.donate.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/time-bank.donate.test.ts)
  - [server/src/services/__tests__/time-bank.service.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/time-bank.service.test.ts)
  - [server/src/services/__tests__/time-bank.transfer.test.ts](file:///e:/work/auto-community/server/src/services/__tests__/time-bank.transfer.test.ts)

### 最小迭代单元 2：kitchen-order.service SELECT * 替换
- 提交：`a2a9079`（已 push）
- 问题根因：4 处 SELECT * FROM kitchen_orders/kitchen_posts。createOrder 中的 kitchen_posts 查询返回 description TEXT/allergens TEXT[] 等未被消费的大字段，存在性能损耗
- 修复方案：
  - 新增 KITCHEN_ORDER_COLUMNS 常量（16 字段，含 seller_id/pickup_time/remark 迁移 002 添加）
  - 3 处 SELECT * FROM kitchen_orders WHERE id = $1 FOR UPDATE 替换为反引号模板插值
  - INSERT INTO kitchen_orders RETURNING * 替换为 RETURNING ${KITCHEN_ORDER_COLUMNS}
  - createOrder 中 kitchen_posts 查询改为仅 6 个消费字段（id/user_id/title/images/remaining_portions/credit_price）有性能收益
- 修改文件：[server/src/services/kitchen-order.service.ts](file:///e:/work/auto-community/server/src/services/kitchen-order.service.ts)

### 最小迭代单元 3：time-bank.service 剩余 4 处 SELECT * 替换
- 提交：`eda2138`（已 push）
- 问题根因：time_services/time_transactions/time_accounts 共 4 处 SELECT * 未替换。createOrder 中的 time_services 查询返回 description TEXT/certification JSONB/images TEXT[] 等未被消费的大字段
- 修复方案：
  - 新增 TIME_SERVICE_COLUMNS（15 字段）和 TIME_TRANSACTION_COLUMNS（10 字段）两个常量
  - updateService 中 SELECT 和 UPDATE RETURNING * 替换为 TIME_SERVICE_COLUMNS（toService 需全字段）
  - createOrder 中 time_services 查询改为仅 4 个消费字段（id/user_id/status/duration_minutes）有性能收益
  - getAccount 替换为 TIME_ACCOUNT_COLUMNS；getTimeHistory 替换为 TIME_TRANSACTION_COLUMNS
- 修改文件：[server/src/services/time-bank.service.ts](file:///e:/work/auto-community/server/src/services/time-bank.service.ts)

### 最小迭代单元 4：emergency-resource.service SELECT * 替换
- 提交：`f7edee9`（已 push）
- 问题根因：2 处 SELECT * FROM emergency_resources，违反精确列名规范。emergency_resources 含 description TEXT 字段，toResourceResponse 消费所有字段故无法减少字段，但显式列名可防御未来新增字段意外泄露
- 修复方案：
  - 新增 EMERGENCY_RESOURCE_COLUMNS 常量（12 字段，不含 deleted_at）
  - 列表查询和详情查询 2 处 SELECT * 替换为反引号模板插值
- 修改文件：[server/src/services/emergency-resource.service.ts](file:///e:/work/auto-community/server/src/services/emergency-resource.service.ts)

### 最小迭代单元 5：emergency.service 5 处 SELECT * 替换
- 提交：`daa78ce`（已 push）
- 问题根因：5 处 SELECT * 涉及 emergency_requests/emergency_responses/false_reports 三个表。三个表均含 TEXT/TEXT[] 大字段（description/message/reason/evidence）
- 修复方案：
  - 新增 3 个常量：EMERGENCY_REQUEST_COLUMNS（17 字段，含迁移 002 添加的 type）、EMERGENCY_RESPONSE_COLUMNS（11 字段，含迁移 002 添加的 eta/timeout_at）、FALSE_REPORT_COLUMNS（12 字段，含迁移 009 添加的 resolution）
  - 替换 5 处 SELECT *：respondToRequest 中 emergency_requests 查询、completeResponse 中 emergency_responses 事务外查询 + 事务内 emergency_requests/emergency_responses 行锁查询、resolveFalseReport 中 false_reports 行锁查询
  - 所有替换均使用反引号确保 ${...} 模板插值生效（吸取上轮单引号失效 BUG 教训）
- 修改文件：[server/src/services/emergency.service.ts](file:///e:/work/auto-community/server/src/services/emergency.service.ts)

## 验证结果（最终）
- 后端 `npx tsc --noEmit` ✅（零错误）
- 后端 `npx vitest run` ✅（73 文件 1439/1439 通过）
- 前端 `npm run build` ✅（8.26s 零错误零警告）
- kitchen-order 专项测试 ✅（24 用例全绿）
- emergency 专项测试 ✅（service 30 + route 24 = 54 用例全绿）
- emergency-resource 专项测试 ✅（18 用例全绿）
- time-bank 全套测试 ✅（service 61 + transfer 13 + donate 13 + family-unbind 8 + create-service 9 + update-service 8 = 112 用例全绿）

## 遗留问题
- 高德地图 Key 实际未配置（AMAP_KEY 为空），生产部署后地图页运行在降级模式（静态点位 + 列表）
- CD 流水线依赖 GitHub Secrets 与远程服务器 GHCR 登录态，需运维侧确认
- 迁移文件时间戳冲突（012 和 018 各有 2 个文件共享同一时间戳），不影响功能但不规范，修改时间戳有迁移记录不一致风险，暂不处理
- ResourceMap setTimeout 绑定 onclick（与高德地图相关，降级模式下无实际效果，待配置高德 Key 后处理）
- 生产就绪标准第 5 项（全页面移动端适配）需人工最终复查
- 生产就绪标准第 6 项（CI/CD 流水线）需运维确认 Secrets 配置
- **P0 安全遗留**：.env.example 历史 commit 中仍含泄露凭据，需运维侧轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史（git filter-repo）或重建仓库
- **P2 性能优化进度**：本轮新增替换 5 个文件 14 处 SELECT *（time_accounts 2 处 + kitchen_orders 4 处 + kitchen_posts 1 处 + time_services 3 处 + time_transactions 1 处 + time_accounts getAccount 1 处 + emergency_resources 2 处 + emergency_requests 2 处 + emergency_responses 2 处 + false_reports 1 处）。累计已替换 8 个表 38 处。剩余约 16 处待替换（admin.service.ts 4 处 skill_orders/kitchen_orders/time_orders/verification_requests、auth.service.ts 1 处 users、address.service.ts 3 处 delivery_addresses、data-deletion.service.ts 1 处 deletion_requests、group-order.service.ts 5 处 group_orders/group_order_participants、message.service.ts 1 处 messages、notification.service.ts 1 处 notifications、user.service.ts 2 处 credit_transactions）

## 下一轮迭代建议
按规范优先级排序：
1. **运维侧紧急处理**：轮换 DB/Redis 密码与 JWT 密钥，清理 git 历史中的泄露凭据
2. P2 SELECT * 替换继续推进：剩余约 16 处，可按文件聚合处理（admin.service.ts 含 4 处可一并处理，group-order.service.ts 含 5 处可一并处理）
3. 生产就绪人工复查：全页面移动端适配、交互体验、状态提示完整性
4. 运维侧确认：CD 流水线 GitHub Secrets 与 GHCR 登录态配置
5. 高德地图 Key 配置后：处理 ResourceMap setTimeout onclick 清理问题

## 本次迭代摘要（2026-07-12 02:50）
- 完成任务：TimeAccountRow 类型修复 + SELECT * 替换推进（time_accounts/kitchen_orders/kitchen_posts/time_services/time_transactions/emergency_resources/emergency_requests/emergency_responses/false_reports 共 9 个表 14 处）
- 修改文件：server/src/services/time-bank.service.ts, kitchen-order.service.ts, emergency-resource.service.ts, emergency.service.ts, __tests__/time-bank.donate.test.ts, __tests__/time-bank.service.test.ts, __tests__/time-bank.transfer.test.ts（共 7 个文件，5 次提交）
- 验证结果：类型检查 ✅ | 测试 ✅（1439/1439）| 构建 ✅
- 遗留问题：SELECT * 替换剩约 16 处待推进；.env.example 历史 commit 凭据泄露需运维处理；高德 Key 未配置；CD 流水线依赖运维 Secrets
- 下一轮建议：SELECT * 替换继续推进（admin.service 4 处 + group-order.service 5 处）+ 运维紧急轮换密钥
